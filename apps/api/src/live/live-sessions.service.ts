import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  clampRevealIntervalMs,
  clampScoreEveryTurns,
  DEFAULT_REVEAL_INTERVAL_MS,
  DEFAULT_SCORE_EVERY_TURNS,
  emptyScoringState,
  providerPricing,
  type AppendTurnInput,
  type Evaluation,
  type LiveHistoryPoint,
  type LiveSessionDetail,
  type LiveSource,
  type ScoringProvider,
  type ScoringState,
  type TranscriptTurn,
} from '@scorecard/domain';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { CallsService } from '../calls/calls.service.js';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { percentile, RunsService } from '../runs/runs.service.js';
import { ScorecardsService } from '../scorecards/scorecards.service.js';
import { LiveSessionEntity } from './live-session.entity.js';

export interface CreateLiveSession {
  readonly callId: string;
  readonly provider: ScoringProvider;
  readonly source: LiveSource;
  readonly intervalMs?: number | undefined;
  readonly scoreEveryTurns?: number | undefined;
}

// A session row with the call and scorecard version it points at.
export type LoadedSession = LiveSessionEntity;

// Persistence for live sessions. It records what has been revealed and scored; deciding
// when to score is the coordinator's job.
@Injectable()
export class LiveSessionsService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(LiveSessionEntity) private readonly sessions: Repository<LiveSessionEntity>,
    private readonly dataSource: DataSource,
    private readonly scorecards: ScorecardsService,
    private readonly calls: CallsService,
    private readonly runs: RunsService,
    private readonly evaluations: EvaluationsService,
  ) {}

  // Timers do not survive a restart, so anything that was playing comes back paused.
  async onApplicationBootstrap(): Promise<void> {
    const updatedAt = new Date().toISOString();
    await this.sessions.update({ status: 'playing' }, { status: 'paused', updatedAt });
    await this.sessions.update(
      { isProcessing: true },
      { isProcessing: false, requestStartedAt: null, updatedAt },
    );
  }

  async create(options: CreateLiveSession): Promise<string | null> {
    if (!(await this.calls.findEntity(options.callId))) return null;
    const scorecard = await this.scorecards.getActive();
    const runId = await this.runs.create('live', options.provider, scorecard.id, 1);
    const id = `live-${randomUUID()}`;
    const now = new Date().toISOString();
    await this.sessions.insert({
      id,
      callId: options.callId,
      runId,
      provider: options.provider,
      scorecardVersionId: scorecard.id,
      source: options.source,
      // A stream has no timer to start: it is live from the moment it is created.
      status: options.source === 'stream' ? 'playing' : 'ready',
      revealIntervalMs: clampRevealIntervalMs(options.intervalMs ?? DEFAULT_REVEAL_INTERVAL_MS),
      scoreEveryTurns: clampScoreEveryTurns(options.scoreEveryTurns ?? DEFAULT_SCORE_EVERY_TURNS),
      state: emptyScoringState,
      latestEvaluationId: null,
      requestStartedAt: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  load(id: string): Promise<LoadedSession | null> {
    return this.sessions.findOne({
      where: { id },
      relations: { call: true, scorecardVersion: true },
    });
  }

  // Everything the browser shows for a session, in one response.
  async findDetail(id: string): Promise<LiveSessionDetail | null> {
    const session = await this.load(id);
    if (!session) return null;
    const [evaluation, passes, requests] = await Promise.all([
      session.latestEvaluationId ? this.evaluations.findDocument(session.latestEvaluationId) : null,
      this.evaluations.findForRun(session.runId),
      this.runs.listRequests(session.runId),
    ]);
    // Score history comes from the flat skill rows, so a long session never re-reads
    // evaluation documents to draw its sparklines.
    const history = passes.map((pass, index): LiveHistoryPoint => ({
      sequence: index + 1,
      turnCount: pass.turnCount,
      overallScore: pass.overallScore,
      coverage: pass.coverage,
      skills: pass.skillResults.map((skill) => ({
        skillId: skill.skillId,
        normalizedScore: skill.normalizedScore,
        observability: skill.observability,
      })),
    }));
    const latencies = requests.filter((request) => request.ok).map((request) => request.latencyMs);
    const sum = (valueOf: (request: (typeof requests)[number]) => number): number =>
      requests.reduce((total, request) => total + valueOf(request), 0);
    const { call } = session;
    return {
      id: session.id,
      callId: session.callId,
      runId: session.runId,
      provider: session.provider,
      source: session.source,
      status: session.status,
      call: {
        subject: call.subject,
        customerName: call.customerName,
        agentName: call.agentName,
        durationSeconds: call.durationSeconds,
      },
      scorecardVersion: session.scorecardVersion.version,
      definition: session.scorecardVersion.definition,
      revealedTurnCount: session.revealedTurnCount,
      // Nobody knows how long a stream will be until its source says it has ended.
      totalTurns:
        session.source === 'replay' || session.inputComplete ? call.transcript.length : null,
      scoredTurnCount: session.scoredTurnCount,
      pendingTurnCount: Math.max(0, session.revealedTurnCount - session.scoredTurnCount),
      isProcessing: session.isProcessing,
      requestStartedAt: session.requestStartedAt,
      elapsedMs: session.elapsedMs,
      revealIntervalMs: session.revealIntervalMs,
      scoreEveryTurns: session.scoreEveryTurns,
      transcript: call.transcript.slice(0, session.revealedTurnCount),
      evaluation,
      history,
      requests,
      totals: {
        requests: requests.length,
        questions: sum((request) => request.questionCount),
        inputTokens: sum((request) => request.inputTokens),
        outputTokens: sum((request) => request.outputTokens),
        estimatedCostUsd: sum((request) => request.estimatedCostUsd),
        latencyAvgMs: latencies.length
          ? Math.round(latencies.reduce((total, latency) => total + latency, 0) / latencies.length)
          : null,
        latencyP95Ms: percentile(latencies, 0.95),
      },
      pricing: providerPricing(session.provider),
      updatedAt: session.updatedAt,
      error: session.error,
    };
  }

  async setPacing(
    id: string,
    pacing: {
      readonly intervalMs?: number | undefined;
      readonly scoreEveryTurns?: number | undefined;
    },
  ): Promise<void> {
    await this.sessions.update(
      { id },
      {
        ...(pacing.intervalMs === undefined
          ? {}
          : { revealIntervalMs: clampRevealIntervalMs(pacing.intervalMs) }),
        ...(pacing.scoreEveryTurns === undefined
          ? {}
          : { scoreEveryTurns: clampScoreEveryTurns(pacing.scoreEveryTurns) }),
        updatedAt: new Date().toISOString(),
      },
    );
  }

  async setStatus(id: string, status: 'playing' | 'paused'): Promise<void> {
    const session = await this.sessions.findOneBy({ id });
    if (!session || session.status === 'completed' || session.status === 'failed') return;
    await this.sessions.update(
      { id },
      { status, error: null, updatedAt: new Date().toISOString() },
    );
  }

  // Replay: show the next stored turn. False once there is nothing left to reveal.
  async revealTurn(id: string): Promise<boolean> {
    const session = await this.load(id);
    if (!session || session.status !== 'playing' || session.source !== 'replay') return false;
    const total = session.call.transcript.length;
    if (session.revealedTurnCount >= total) return false;
    const revealed = session.revealedTurnCount + 1;
    await this.sessions.update(
      { id },
      {
        revealedTurnCount: revealed,
        inputComplete: revealed >= total,
        // Accumulated rather than multiplied, so a pace change mid-replay stays honest.
        elapsedMs: session.elapsedMs + session.revealIntervalMs,
        updatedAt: new Date().toISOString(),
      },
    );
    return true;
  }

  // Stream: a real-time source pushed one more turn.
  async appendTurn(id: string, input: AppendTurnInput): Promise<TranscriptTurn | null> {
    const session = await this.sessions.findOneBy({ id });
    if (
      !session ||
      session.source !== 'stream' ||
      session.status !== 'playing' ||
      session.inputComplete
    ) {
      return null;
    }
    const turn = await this.calls.appendTurn(session.callId, input);
    if (!turn) return null;
    await this.sessions.update(
      { id },
      {
        revealedTurnCount: session.revealedTurnCount + 1,
        elapsedMs: Math.max(0, Date.now() - Date.parse(session.createdAt)),
        updatedAt: new Date().toISOString(),
      },
    );
    return turn;
  }

  // Stream: the source says the call is over, so the next pass is the final one.
  async endInput(id: string): Promise<void> {
    await this.sessions.update(
      { id, source: 'stream', status: 'playing' },
      { inputComplete: true, updatedAt: new Date().toISOString() },
    );
  }

  async beginScoring(id: string, runId: string, requestStartedAt: string): Promise<void> {
    await this.sessions.update(
      { id, runId },
      { isProcessing: true, requestStartedAt, updatedAt: requestStartedAt },
    );
    await this.runs.markLiveStarted(runId, requestStartedAt);
  }

  // Store one pass. The run id guards against a reset that happened while the request
  // was in flight: results for an abandoned run are dropped, not written onto the new one.
  async saveEvaluation(
    id: string,
    runId: string,
    state: ScoringState,
    evaluation: Evaluation,
  ): Promise<boolean> {
    const final = evaluation.stage === 'final';
    const saved = await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOneBy(LiveSessionEntity, { id });
      if (!session || session.runId !== runId) return false;
      await this.evaluations.save(evaluation, manager);
      await manager.update(
        LiveSessionEntity,
        { id },
        {
          scoredTurnCount: evaluation.turnCount,
          isProcessing: false,
          requestStartedAt: null,
          state,
          latestEvaluationId: evaluation.id,
          status: final ? 'completed' : session.status,
          error: null,
          updatedAt: new Date().toISOString(),
        },
      );
      return true;
    });
    if (saved && final) await this.runs.finishLive(runId, 'completed');
    return saved;
  }

  async fail(id: string, runId: string, error: string): Promise<void> {
    await this.sessions.update(
      { id, runId },
      {
        status: 'failed',
        isProcessing: false,
        requestStartedAt: null,
        error,
        updatedAt: new Date().toISOString(),
      },
    );
    await this.runs.finishLive(runId, 'failed');
  }

  // Rewind a replay. The session gets a fresh run, so the abandoned run's evaluations
  // and request ledger stay intact and attributable instead of being overwritten.
  async reset(id: string): Promise<void> {
    const session = await this.sessions.findOneBy({ id, source: 'replay' });
    if (!session) return;
    await this.runs.finishLive(session.runId, 'cancelled');
    const scorecard = await this.scorecards.getActive();
    const runId = await this.runs.create('live', session.provider, scorecard.id, 1);
    await this.sessions.update(
      { id },
      {
        runId,
        scorecardVersionId: scorecard.id,
        status: 'ready',
        inputComplete: false,
        revealedTurnCount: 0,
        scoredTurnCount: 0,
        isProcessing: false,
        requestStartedAt: null,
        elapsedMs: 0,
        state: emptyScoringState,
        latestEvaluationId: null,
        error: null,
        updatedAt: new Date().toISOString(),
      },
    );
  }
}
