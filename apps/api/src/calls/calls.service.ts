import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  AppendTurnInput,
  CallDetail,
  CallStatus,
  CallSummary,
  CallTranscript,
  EvaluationSummary,
  ScoringProvider,
  TranscriptTurn,
} from '@scorecard/domain';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { EvaluationsService } from '../evaluations/evaluations.service.js';
import { CoachReviewEntity } from '../reviews/coach-review.entity.js';
import { RunCallEntity } from '../runs/run-call.entity.js';
import { CallEntity } from './call.entity.js';

// A call has no stored status. It is derived: being scored right now, scored at least
// once, failed on its most recent attempt, or untouched.
const statusOf = (latestRunStatus: CallStatus | undefined, scored: boolean): CallStatus =>
  latestRunStatus === 'processing'
    ? 'processing'
    : scored
      ? 'completed'
      : latestRunStatus === 'failed'
        ? 'failed'
        : 'pending';

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(CallEntity) private readonly calls: Repository<CallEntity>,
    @InjectRepository(RunCallEntity) private readonly runCalls: Repository<RunCallEntity>,
    @InjectRepository(CoachReviewEntity) private readonly reviews: Repository<CoachReviewEntity>,
    private readonly evaluations: EvaluationsService,
  ) {}

  async list(): Promise<CallSummary[]> {
    const [calls, latest, runCalls, reviewCounts] = await Promise.all([
      this.calls.find({ order: { startedAt: 'DESC' } }),
      this.evaluations.latestFinalByCall(),
      this.runCalls.find({ order: { updatedAt: 'DESC' } }),
      this.submittedReviewCounts(),
    ]);
    // Rows are newest first, so the first one seen for a call is its latest attempt.
    const latestAttempt = new Map<string, RunCallEntity>();
    for (const runCall of runCalls) {
      if (!latestAttempt.has(runCall.callId)) latestAttempt.set(runCall.callId, runCall);
    }
    return calls.map((call) =>
      this.toSummary(
        call,
        latest.get(call.id) ?? null,
        latestAttempt.get(call.id),
        reviewCounts.get(call.id) ?? 0,
      ),
    );
  }

  async findDetail(id: string, provider?: ScoringProvider): Promise<CallDetail | null> {
    const call = await this.calls.findOneBy({ id });
    if (!call) return null;
    const [evaluations, evaluation, attempt, reviewCounts] = await Promise.all([
      this.evaluations.latestFinalsForCall(id),
      this.evaluations.latestFinalDocumentForCall(id, provider),
      this.runCalls.findOne({ where: { callId: id }, order: { updatedAt: 'DESC' } }),
      this.submittedReviewCounts(),
    ]);
    return {
      ...this.toSummary(
        call,
        evaluations[0] ?? null,
        attempt ?? undefined,
        reviewCounts.get(id) ?? 0,
      ),
      transcript: call.transcript,
      evaluation,
      evaluations,
    };
  }

  // What a coach reviewing blind is given: the conversation, and nothing the AI made of it.
  async findTranscript(id: string): Promise<CallTranscript | null> {
    const call = await this.calls.findOneBy({ id });
    if (!call) return null;
    const { subject, customerName, agentName, startedAt, durationSeconds, transcript } = call;
    return { id, subject, customerName, agentName, startedAt, durationSeconds, transcript };
  }

  findEntity(id: string): Promise<CallEntity | null> {
    return this.calls.findOneBy({ id });
  }

  // Ids of every call that has a transcript to score, newest first.
  async scoreableIds(): Promise<string[]> {
    const calls = await this.calls.find({ order: { startedAt: 'DESC' } });
    return calls.filter((call) => call.transcript.length > 0).map((call) => call.id);
  }

  // A call that arrives turn by turn over the ingest API starts with an empty transcript.
  async createStreamCall(input: {
    readonly subject: string;
    readonly customerName: string;
    readonly agentName: string;
  }): Promise<string> {
    const id = `call-${randomUUID()}`;
    await this.calls.insert({
      id,
      ...input,
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      source: 'stream',
      transcript: [],
    });
    return id;
  }

  async appendTurn(callId: string, input: AppendTurnInput): Promise<TranscriptTurn | null> {
    const call = await this.calls.findOneBy({ id: callId });
    if (!call) return null;
    const startSeconds =
      input.startSeconds ??
      Math.max(0, Math.round((Date.now() - Date.parse(call.startedAt)) / 1000));
    const turn: TranscriptTurn = {
      id: `turn-${call.transcript.length + 1}`,
      speaker: input.speaker,
      text: input.text,
      startSeconds,
    };
    await this.calls.update(
      { id: callId },
      { transcript: [...call.transcript, turn], durationSeconds: Math.round(startSeconds) },
    );
    return turn;
  }

  private async submittedReviewCounts(): Promise<ReadonlyMap<string, number>> {
    const rows = await this.reviews
      .createQueryBuilder('r')
      .select('r.callId', 'callId')
      .addSelect('COUNT(*)', 'count')
      .where("r.status = 'submitted'")
      .groupBy('r.callId')
      .getRawMany<{ callId: string; count: number }>();
    return new Map(rows.map((row) => [row.callId, Number(row.count)]));
  }

  private toSummary(
    call: CallEntity,
    latest: EvaluationSummary | null,
    attempt: RunCallEntity | undefined,
    submittedReviews: number,
  ): CallSummary {
    const status = statusOf(attempt?.status, latest !== null);
    return {
      id: call.id,
      customerName: call.customerName,
      agentName: call.agentName,
      subject: call.subject,
      startedAt: call.startedAt,
      durationSeconds: call.durationSeconds,
      turnCount: call.transcript.length,
      source: call.source,
      status,
      error: status === 'failed' ? (attempt?.error ?? null) : null,
      latest,
      submittedReviews,
    };
  }
}
