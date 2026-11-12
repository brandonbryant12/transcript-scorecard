import { BadRequestException, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  agreementStats,
  SCORING_METHOD,
  type CoachReview,
  type LevelPair,
  type ProviderRequestRecord,
  type RunDetail,
  type RunKind,
  type RunMetrics,
  type RunStatus,
  type RunSummary,
  type ScoringProvider,
  type Stage,
} from '@scorecard/domain';
import { randomUUID } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { CallsService } from '../calls/calls.service.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { ScorecardsService } from '../scorecards/scorecards.service.js';
import type { RequestRecord } from '../scoring/scoring-engine.service.js';
import { ProviderRequestEntity } from './provider-request.entity.js';
import { RunCallEntity } from './run-call.entity.js';
import { ScoringRunEntity } from './scoring-run.entity.js';

const RECENT_RUNS = 40;

export const percentile = (values: ReadonlyArray<number>, fraction: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!;
};

const sum = <T>(items: ReadonlyArray<T>, valueOf: (item: T) => number): number =>
  items.reduce((total, item) => total + valueOf(item), 0);

export interface BatchRun {
  readonly runId: string;
  readonly callIds: ReadonlyArray<string>;
  readonly provider: ScoringProvider;
  readonly scorecardVersionId: string;
}

// Scoring runs and the measurements taken on them: the per-request ledger, and each
// run's latency, cost and agreement with coach ground truth.
@Injectable()
export class RunsService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(ScoringRunEntity) private readonly runs: Repository<ScoringRunEntity>,
    @InjectRepository(RunCallEntity) private readonly runCalls: Repository<RunCallEntity>,
    @InjectRepository(ProviderRequestEntity)
    private readonly requests: Repository<ProviderRequestEntity>,
    private readonly scorecards: ScorecardsService,
    private readonly calls: CallsService,
    private readonly evaluations: EvaluationsService,
    private readonly reviews: ReviewsService,
  ) {}

  // A process that exits mid-run must not leave work that looks permanently in progress.
  async onApplicationBootstrap(): Promise<void> {
    const now = new Date().toISOString();
    await this.runCalls.update(
      { status: 'processing' },
      { status: 'failed', error: 'Interrupted by a server restart', updatedAt: now },
    );
    await this.runs.update(
      { kind: 'batch', status: In(['queued', 'running']) },
      { status: 'failed', completedAt: now },
    );
  }

  async create(
    kind: RunKind,
    provider: ScoringProvider,
    scorecardVersionId: string,
    total: number,
  ): Promise<string> {
    const id = `run-${randomUUID()}`;
    await this.runs.insert({
      id,
      kind,
      provider,
      scorecardVersionId,
      methodVersion: SCORING_METHOD.version,
      status: kind === 'live' ? 'running' : 'queued',
      total,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    });
    return id;
  }

  async createBatch(
    provider: ScoringProvider,
    requested?: ReadonlyArray<string>,
  ): Promise<BatchRun> {
    const scoreable = await this.calls.scoreableIds();
    const callIds = requested?.length ? [...new Set(requested)] : scoreable;
    if (callIds.length === 0) throw new BadRequestException('No calls selected');
    const unknown = callIds.filter((id) => !scoreable.includes(id));
    if (unknown.length > 0)
      throw new BadRequestException(`Unknown call IDs: ${unknown.join(', ')}`);

    const scorecard = await this.scorecards.getActive();
    const runId = await this.create('batch', provider, scorecard.id, callIds.length);
    const updatedAt = new Date().toISOString();
    await this.runCalls.insert(
      callIds.map((callId, position) => ({
        runId,
        callId,
        position,
        status: 'pending' as const,
        error: null,
        evaluationId: null,
        updatedAt,
      })),
    );
    return { runId, callIds, provider, scorecardVersionId: scorecard.id };
  }

  async markStarted(runId: string): Promise<void> {
    await this.runs.update(
      { id: runId },
      { status: 'running', startedAt: new Date().toISOString() },
    );
  }

  async markCallProcessing(runId: string, callId: string): Promise<void> {
    await this.runCalls.update(
      { runId, callId },
      { status: 'processing', error: null, updatedAt: new Date().toISOString() },
    );
  }

  async completeCall(runId: string, callId: string, evaluationId: string): Promise<void> {
    await this.runCalls.update(
      { runId, callId },
      { status: 'completed', error: null, evaluationId, updatedAt: new Date().toISOString() },
    );
    await this.runs.increment({ id: runId }, 'completed', 1);
  }

  async failCall(runId: string, callId: string, error: string): Promise<void> {
    await this.runCalls.update(
      { runId, callId },
      { status: 'failed', error, updatedAt: new Date().toISOString() },
    );
    await this.runs.increment({ id: runId }, 'completed', 1);
    await this.runs.increment({ id: runId }, 'failed', 1);
  }

  async finishBatch(runId: string): Promise<void> {
    const run = await this.runs.findOneBy({ id: runId });
    if (!run) return;
    const status: RunStatus =
      run.completed < run.total || run.failed === run.total
        ? 'failed'
        : run.failed > 0
          ? 'completed_with_errors'
          : 'completed';
    await this.runs.update({ id: runId }, { status, completedAt: new Date().toISOString() });
  }

  // A live run ends when its session does: completed, failed, or cancelled by a reset.
  async finishLive(runId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    await this.runs.update(
      { id: runId, status: 'running' },
      {
        status,
        completed: status === 'completed' ? 1 : 0,
        failed: status === 'failed' ? 1 : 0,
        completedAt: new Date().toISOString(),
      },
    );
  }

  async markLiveStarted(runId: string, startedAt: string): Promise<void> {
    const run = await this.runs.findOneBy({ id: runId });
    if (run && run.startedAt === null) await this.runs.update({ id: runId }, { startedAt });
  }

  async recordRequest(
    run: { readonly runId: string; readonly callId: string; readonly provider: ScoringProvider },
    stage: Stage,
    turnCount: number,
    record: RequestRecord,
  ): Promise<void> {
    await this.requests.insert({ ...run, stage, turnCount, ...record });
  }

  async listRequests(runId: string): Promise<ProviderRequestRecord[]> {
    const requests = await this.requests.find({ where: { runId }, order: { id: 'ASC' } });
    return requests.map((request, index) => ({
      sequence: index + 1,
      stage: request.stage,
      turnCount: request.turnCount,
      questionCount: request.questionCount,
      inputTokens: request.inputTokens,
      outputTokens: request.outputTokens,
      latencyMs: request.latencyMs,
      estimatedCostUsd: request.estimatedCostUsd,
      ok: request.ok,
      startedAt: request.startedAt,
    }));
  }

  // Recent runs that actually reached a provider. A live replay that was created but
  // never started made no requests and is not worth a row.
  async list(): Promise<RunSummary[]> {
    const reviews = await this.reviews.listSubmitted();
    const runs = await this.runs
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.scorecardVersion', 'v')
      .where("r.kind = 'batch'")
      .orWhere((query) => {
        const hasRequests = query
          .subQuery()
          .select('1')
          .from(ProviderRequestEntity, 'p')
          .where('p.runId = r.id');
        return `EXISTS ${hasRequests.getQuery()}`;
      })
      .orderBy('r.createdAt', 'DESC')
      .take(RECENT_RUNS)
      .getMany();
    return Promise.all(
      runs.map(async (run) => this.toSummary(run, await this.metrics(run.id, reviews))),
    );
  }

  async findDetail(id: string): Promise<RunDetail | null> {
    const run = await this.runs.findOne({ where: { id }, relations: { scorecardVersion: true } });
    if (!run) return null;
    const [reviews, runCalls, evaluations] = await Promise.all([
      this.reviews.listSubmitted(),
      this.runCalls.find({
        where: { runId: id },
        relations: { call: true },
        order: { position: 'ASC' },
      }),
      this.evaluations.findForRun(id),
    ]);
    const scores = new Map(
      evaluations.map((evaluation) => [evaluation.id, evaluation.overallScore]),
    );
    return {
      ...this.toSummary(run, await this.metrics(id, reviews)),
      results: runCalls.map((runCall) => ({
        callId: runCall.callId,
        subject: runCall.call.subject,
        status: runCall.status,
        overallScore: runCall.evaluationId ? (scores.get(runCall.evaluationId) ?? null) : null,
        error: runCall.error,
      })),
    };
  }

  private async metrics(runId: string, reviews: ReadonlyArray<CoachReview>): Promise<RunMetrics> {
    const [requests, evaluations] = await Promise.all([
      this.listRequests(runId),
      this.evaluations.findForRun(runId),
    ]);
    const finals = evaluations.filter((evaluation) => evaluation.stage === 'final');
    const scores = finals.flatMap((evaluation) =>
      evaluation.overallScore === null ? [] : [evaluation.overallScore],
    );
    const latencies = requests.filter((request) => request.ok).map((request) => request.latencyMs);

    // Agreement of this run's results with coach ground truth, from the flat skill rows.
    // A rating is compared only with an assessed skill on a rubric of the same size.
    const pairs: LevelPair[] = [];
    for (const review of reviews) {
      const evaluation = finals.find((item) => item.callId === review.callId);
      for (const rating of review.ratings) {
        const skill = evaluation?.skillResults.find((result) => result.skillId === rating.skillId);
        if (!skill || !skill.assessed || rating.level === null) continue;
        if (rating.level >= skill.levelCount) continue;
        pairs.push({
          coach: rating.level,
          ai: skill.level,
          aiExpected: skill.expectedLevel,
          levels: skill.levelCount,
          confidence: skill.confidence,
        });
      }
    }

    return {
      evaluations: finals.length,
      averageScore: scores.length
        ? Math.round((sum(scores, (score) => score) / scores.length) * 10) / 10
        : null,
      needsReview: finals.filter((evaluation) => evaluation.needsReview).length,
      requests: requests.length,
      questions: sum(requests, (request) => request.questionCount),
      inputTokens: sum(requests, (request) => request.inputTokens),
      outputTokens: sum(requests, (request) => request.outputTokens),
      estimatedCostUsd: sum(requests, (request) => request.estimatedCostUsd),
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      agreement: pairs.length > 0 ? agreementStats(pairs) : null,
    };
  }

  private toSummary(run: ScoringRunEntity, metrics: RunMetrics): RunSummary {
    return {
      id: run.id,
      kind: run.kind,
      provider: run.provider,
      scorecardVersionId: run.scorecardVersionId,
      scorecardVersion: run.scorecardVersion.version,
      methodVersion: run.methodVersion,
      status: run.status,
      total: run.total,
      completed: run.completed,
      failed: run.failed,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      metrics,
    };
  }
}
