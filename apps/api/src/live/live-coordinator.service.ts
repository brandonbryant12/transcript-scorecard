import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  clampRevealIntervalMs,
  type AppendTurnInput,
  type ControlLiveInput,
  type CreateStreamInput,
  type LiveSessionDetail,
  type ScoringProvider,
  type TranscriptTurn,
} from '@scorecard/domain';
import { concat, defer, filter, from, Subject, switchMap, type Observable } from 'rxjs';
import { CallsService } from '../calls/calls.service.js';
import { ProviderError } from '../decisions/provider.error.js';
import { toEvaluation } from '../evaluations/to-evaluation.js';
import { RunsService } from '../runs/runs.service.js';
import type { TurnMedia } from '../scoring/question-plan.js';
import { ScoringEngine } from '../scoring/scoring-engine.service.js';
import { LiveSessionsService, type LoadedSession } from './live-sessions.service.js';
import { TurnMediaStore } from './turn-media.store.js';

// A pass is owed when enough turns have piled up unscored, and always once the input is
// complete: the last pass sees the whole call and is the final evaluation.
const readyToScore = (session: LoadedSession): boolean => {
  if (session.status !== 'playing' || session.revealedTurnCount === 0) return false;
  if (session.inputComplete) return true;
  return session.revealedTurnCount - session.scoredTurnCount >= session.scoreEveryTurns;
};

// Drives every live session, whatever feeds it. A replay reveals stored turns on a timer;
// a stream receives turns from a real-time source. Both end up in the same place: new
// turns on the session, and a call to `kick`.
@Injectable()
export class LiveCoordinator implements OnModuleDestroy {
  private readonly logger = new Logger(LiveCoordinator.name);
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly inFlight = new Set<string>();
  private readonly changes = new Subject<string>();
  private destroyed = false;

  constructor(
    private readonly sessions: LiveSessionsService,
    private readonly calls: CallsService,
    private readonly runs: RunsService,
    private readonly engine: ScoringEngine,
    private readonly media: TurnMediaStore,
  ) {}

  onModuleDestroy(): void {
    this.destroyed = true;
    for (const id of this.timers.keys()) this.clearTimer(id);
    this.changes.complete();
  }

  get(id: string): Promise<LiveSessionDetail | null> {
    return this.sessions.findDetail(id);
  }

  // The session as it is now, then again after every change, for Server-Sent Events.
  // `switchMap` drops a snapshot that is still loading when a newer change arrives.
  watch(id: string): Observable<LiveSessionDetail> {
    const snapshot = () =>
      from(this.sessions.findDetail(id)).pipe(filter((session) => session !== null));
    return concat(
      defer(snapshot),
      this.changes.pipe(
        filter((changed) => changed === id),
        switchMap(snapshot),
      ),
    );
  }

  async createReplay(
    callId: string,
    provider: ScoringProvider,
    pacing: {
      readonly intervalMs?: number | undefined;
      readonly scoreEveryTurns?: number | undefined;
    },
  ): Promise<LiveSessionDetail | null> {
    const id = await this.sessions.create({ callId, provider, source: 'replay', ...pacing });
    return id ? this.sessions.findDetail(id) : null;
  }

  async createStream(
    input: CreateStreamInput,
    provider: ScoringProvider,
  ): Promise<LiveSessionDetail> {
    const callId = await this.calls.createStreamCall(input);
    const id = await this.sessions.create({
      callId,
      provider,
      source: 'stream',
      scoreEveryTurns: input.scoreEveryTurns,
    });
    return (await this.sessions.findDetail(id!))!;
  }

  // Add a turn to a stream. `media` is the turn's audio clip and video frames, when the
  // source captured them; it is stored before scoring is triggered so the pass that
  // reads the turn's words can read its sound and picture too.
  async appendTurn(
    id: string,
    input: AppendTurnInput,
    media?: TurnMedia,
  ): Promise<TranscriptTurn | null> {
    const turn = await this.sessions.appendTurn(id, input);
    if (turn) {
      if (media) this.media.put(id, turn.id, media);
      this.changes.next(id);
      this.background(this.kick(id));
    }
    return turn;
  }

  async control(id: string, input: ControlLiveInput): Promise<LiveSessionDetail | null> {
    const session = await this.sessions.load(id);
    if (!session) return null;
    if (input.intervalMs !== undefined || input.scoreEveryTurns !== undefined) {
      await this.sessions.setPacing(id, input);
    }

    if (input.action === 'end') {
      await this.sessions.endInput(id);
    } else if (session.source === 'replay') {
      if (input.action === 'reset') {
        this.clearTimer(id);
        this.media.clear(id);
        await this.sessions.reset(id);
      } else if (input.action === 'pause') {
        this.clearTimer(id);
        await this.sessions.setStatus(id, 'paused');
      } else if (input.action === 'start') {
        await this.sessions.setStatus(id, 'playing');
        const started = await this.sessions.load(id);
        if (started?.status === 'playing') {
          this.arm(id, started.revealIntervalMs);
          this.background(this.tick(id));
        }
      } else if (session.status === 'playing') {
        // A pace change re-arms the ticker at the new spacing.
        const paced = await this.sessions.load(id);
        if (paced) this.arm(id, paced.revealIntervalMs);
      }
    }
    this.changes.next(id);
    // Any action can leave a pass owed: an ended stream, or a smaller batch size.
    this.background(this.kick(id));
    return this.sessions.findDetail(id);
  }

  // At most one pass per session is in flight. Turns that arrive meanwhile simply wait
  // and are all picked up by the next pass, so a slow provider never builds a queue.
  private async kick(id: string): Promise<void> {
    if (this.destroyed || this.inFlight.has(id)) return;
    this.inFlight.add(id);
    let session: LoadedSession | null = null;
    try {
      session = await this.sessions.load(id);
      if (!session || !readyToScore(session)) return;
      const { runId, callId, provider, scorecardVersionId } = session;
      const turns = session.call.transcript.slice(0, session.revealedTurnCount);
      const stage = session.inputComplete ? 'final' : 'provisional';
      const output = await this.engine.score({
        provider,
        call: session.call,
        definition: session.scorecardVersion.definition,
        turns,
        state: session.state,
        stage,
        media: this.media.get(id),
        onStart: async (startedAt) => {
          await this.sessions.beginScoring(id, runId, startedAt);
          this.changes.next(id);
        },
        onRequest: (record) =>
          this.runs.recordRequest({ runId, callId, provider }, stage, turns.length, record),
      });
      const evaluation = toEvaluation(output, { callId, runId, provider, scorecardVersionId });
      await this.sessions.saveEvaluation(id, runId, output.state, evaluation);
      if (stage === 'final') this.media.clear(id);
    } catch (cause) {
      if (session) {
        if (!(cause instanceof ProviderError))
          this.logger.error(`Scoring session ${id} failed`, cause);
        await this.sessions.fail(
          id,
          session.runId,
          ProviderError.publicMessage(cause, session.provider),
        );
      }
    } finally {
      this.inFlight.delete(id);
      if (!this.destroyed) {
        this.changes.next(id);
        const latest = await this.sessions.load(id);
        if (!latest || latest.status === 'completed' || latest.status === 'failed')
          this.clearTimer(id);
        else if (readyToScore(latest)) this.background(this.kick(id));
      }
    }
  }

  private async tick(id: string): Promise<void> {
    const revealed = await this.sessions.revealTurn(id);
    if (revealed) this.changes.next(id);
    else this.clearTimer(id);
    await this.kick(id);
  }

  private arm(id: string, intervalMs: number): void {
    this.clearTimer(id);
    this.timers.set(
      id,
      setInterval(() => this.background(this.tick(id)), clampRevealIntervalMs(intervalMs)),
    );
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearInterval(timer);
    this.timers.delete(id);
  }

  private background(work: Promise<unknown>): void {
    void work.catch((cause) => this.logger.error('Live session task failed', cause));
  }
}
