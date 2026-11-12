import { z } from 'zod';
import type { Evaluation, TranscriptTurn } from './evaluation.js';
import { ScoringProviderSchema, type ProviderPricing, type ScoringProvider } from './providers.js';
import type { ScorecardDefinition } from './scorecard.js';
import type { AgreementStats } from './validation.js';

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export type CallStatus = 'pending' | 'processing' | 'completed' | 'failed';
// seed: shipped with the demo. stream: turns were pushed in over the ingest API.
export type CallSource = 'seed' | 'stream';

export interface EvaluationSummary {
  readonly evaluationId: string;
  readonly provider: ScoringProvider;
  readonly model: string;
  readonly scorecardVersion: number;
  readonly overallScore: number | null;
  readonly confidence: number;
  readonly needsReview: boolean;
  // How many critical behaviours were detected: any at all means a human should look.
  readonly criticalFlags: number;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly estimatedCostUsd: number;
  readonly createdAt: string;
}

export interface CallSummary {
  readonly id: string;
  readonly customerName: string;
  readonly agentName: string;
  readonly subject: string;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly turnCount: number;
  readonly source: CallSource;
  readonly status: CallStatus;
  readonly error: string | null;
  // The most recent final evaluation from any provider.
  readonly latest: EvaluationSummary | null;
  readonly submittedReviews: number;
}

// A call as a blind reviewer may see it: who was on it and what was said, and nothing
// the AI concluded about it.
export interface CallTranscript {
  readonly id: string;
  readonly subject: string;
  readonly customerName: string;
  readonly agentName: string;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly transcript: ReadonlyArray<TranscriptTurn>;
}

export interface CallDetail extends CallSummary {
  readonly transcript: ReadonlyArray<TranscriptTurn>;
  readonly evaluation: Evaluation | null;
  // The most recent final evaluation from each provider that has scored the call.
  readonly evaluations: ReadonlyArray<EvaluationSummary>;
}

// ---------------------------------------------------------------------------
// Scoring runs and the per-request ledger
// ---------------------------------------------------------------------------

export type RunKind = 'batch' | 'live';
// cancelled: a live replay that was reset before it finished.
export type RunStatus =
  'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'cancelled';

// One row per provider API call: the unit of latency and cost measurement.
export interface ProviderRequestRecord {
  readonly sequence: number;
  readonly stage: 'provisional' | 'final';
  readonly turnCount: number;
  readonly questionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
  readonly ok: boolean;
  readonly startedAt: string;
}

export interface RunMetrics {
  readonly evaluations: number;
  readonly averageScore: number | null;
  readonly needsReview: number;
  readonly requests: number;
  readonly questions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly latencyP50Ms: number | null;
  readonly latencyP95Ms: number | null;
  // Agreement with submitted coach reviews of the calls this run scored.
  readonly agreement: AgreementStats | null;
}

export interface RunSummary {
  readonly id: string;
  readonly kind: RunKind;
  readonly provider: ScoringProvider;
  readonly scorecardVersionId: string;
  readonly scorecardVersion: number;
  readonly methodVersion: string;
  readonly status: RunStatus;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly metrics: RunMetrics;
}

export interface RunCallResult {
  readonly callId: string;
  readonly subject: string;
  readonly status: CallStatus;
  readonly overallScore: number | null;
  readonly error: string | null;
}

export interface RunDetail extends RunSummary {
  readonly results: ReadonlyArray<RunCallResult>;
}

export const StartRunSchema = z.strictObject({
  // Omitted: the server uses the first configured provider.
  provider: ScoringProviderSchema.optional(),
  // Omitted or empty: every call that has a transcript.
  callIds: z.array(z.string().min(1)).optional(),
});
export type StartRunInput = z.infer<typeof StartRunSchema>;

// ---------------------------------------------------------------------------
// Spending: the request ledger summed across runs
// ---------------------------------------------------------------------------

// The kind of work a request was made for. batch: a batch run. replay: a live replay of a
// stored call. stream: a call streamed in over the ingest API. practice: a voice practice
// call (a stream whose call subject starts with "Practice").
export type SpendKind = 'batch' | 'replay' | 'stream' | 'practice';
export const SPEND_KINDS: ReadonlyArray<SpendKind> = ['batch', 'replay', 'stream', 'practice'];

export interface SpendTotals {
  readonly requests: number;
  // Failed requests are counted here and in `requests`; they report no tokens and cost nothing.
  readonly failedRequests: number;
  readonly questions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // Each request's cost was estimated from its reported tokens at the list price in force
  // when it was made, so a later price change does not rewrite past spending.
  readonly estimatedCostUsd: number;
}

// One line of the price list in use now.
export interface SpendPrice {
  readonly provider: ScoringProvider;
  readonly label: string;
  readonly model: string;
  readonly inputUsdPerMillion: number;
  readonly outputUsdPerMillion: number;
  readonly sourceUrl: string;
  readonly checkedAt: string;
}

export interface SpendProviderLine extends SpendTotals {
  readonly provider: ScoringProvider;
}

export interface SpendKindLine extends SpendTotals {
  readonly kind: SpendKind;
}

export interface SpendDayLine extends SpendTotals {
  // A UTC calendar day, YYYY-MM-DD.
  readonly day: string;
}

export interface SpendLedgerRow {
  readonly id: number;
  readonly startedAt: string;
  readonly runId: string;
  readonly callId: string;
  readonly provider: ScoringProvider;
  // null when the request failed before the provider named a model.
  readonly model: string | null;
  readonly kind: SpendKind;
  readonly subject: string | null;
  readonly questionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number;
  readonly ok: boolean;
}

export interface SpendSummary {
  readonly generatedAt: string;
  // Today's UTC date; days are UTC calendar days throughout.
  readonly today: string;
  // How many active days `byDay` was asked for.
  readonly days: number;
  readonly prices: ReadonlyArray<SpendPrice>;
  readonly totals: {
    readonly allTime: SpendTotals;
    readonly today: SpendTotals;
    // Today and the six UTC days before it.
    readonly last7Days: SpendTotals;
  };
  // All time, one line per provider and per kind, in a fixed order, zeros included.
  readonly byProvider: ReadonlyArray<SpendProviderLine>;
  readonly byKind: ReadonlyArray<SpendKindLine>;
  // The most recent `days` days that had any request, newest first.
  readonly byDay: ReadonlyArray<SpendDayLine>;
  // The most recent ledger rows, newest first.
  readonly recent: ReadonlyArray<SpendLedgerRow>;
  // Spending this summary does not see, in plain words.
  readonly excluded: ReadonlyArray<string>;
}

export const DEFAULT_SPEND_DAYS = 30;
export const MAX_SPEND_DAYS = 365;

// `?days=` on GET /api/spend. Query values arrive as strings, so only plain digits are
// accepted before the range check: "7" passes, "7.5", "1e2" and "" do not.
export const SpendDaysSchema = z
  .string({ error: 'days must be given once' })
  .regex(/^\d+$/, 'days must be a whole number')
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, 'days must be at least 1')
      .max(MAX_SPEND_DAYS, `days must be at most ${MAX_SPEND_DAYS}`),
  )
  .optional()
  .transform((days) => days ?? DEFAULT_SPEND_DAYS);

// ---------------------------------------------------------------------------
// Live sessions
// ---------------------------------------------------------------------------

export type LiveStatus = 'ready' | 'playing' | 'paused' | 'completed' | 'failed';
// replay: a stored transcript is revealed on a timer. stream: turns arrive over the
// ingest API from a real-time source such as a speech-to-text model.
export type LiveSource = 'replay' | 'stream';

export interface LiveHistoryPoint {
  readonly sequence: number;
  readonly turnCount: number;
  readonly overallScore: number | null;
  readonly coverage: number;
  readonly skills: ReadonlyArray<{
    readonly skillId: string;
    readonly normalizedScore: number;
    readonly observability: number;
  }>;
}

export interface LiveTotals {
  readonly requests: number;
  readonly questions: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedCostUsd: number;
  readonly latencyAvgMs: number | null;
  readonly latencyP95Ms: number | null;
}

export interface LiveSessionDetail {
  readonly id: string;
  readonly callId: string;
  readonly runId: string;
  readonly provider: ScoringProvider;
  readonly source: LiveSource;
  readonly status: LiveStatus;
  readonly call: {
    readonly subject: string;
    readonly customerName: string;
    readonly agentName: string;
    readonly durationSeconds: number;
  };
  readonly scorecardVersion: number;
  readonly definition: ScorecardDefinition;
  readonly revealedTurnCount: number;
  // null for a stream that has not ended: nobody knows how long the call will be.
  readonly totalTurns: number | null;
  readonly scoredTurnCount: number;
  readonly pendingTurnCount: number;
  readonly isProcessing: boolean;
  readonly requestStartedAt: string | null;
  readonly elapsedMs: number;
  readonly revealIntervalMs: number;
  readonly scoreEveryTurns: number;
  readonly transcript: ReadonlyArray<TranscriptTurn>;
  readonly evaluation: Evaluation | null;
  readonly history: ReadonlyArray<LiveHistoryPoint>;
  readonly requests: ReadonlyArray<ProviderRequestRecord>;
  readonly totals: LiveTotals;
  readonly pricing: ProviderPricing;
  readonly updatedAt: string;
  readonly error: string | null;
}

// Two independent knobs. The transcript reveals one turn per interval, while scoring
// batches: a request goes out once this many turns have accumulated unscored.
export const DEFAULT_REVEAL_INTERVAL_MS = 1_000;
export const MIN_REVEAL_INTERVAL_MS = 250;
export const MAX_REVEAL_INTERVAL_MS = 30_000;
export const REVEAL_INTERVAL_OPTIONS = [250, 500, 1_000, 2_000, 5_000] as const;

export const clampRevealIntervalMs = (value: number): number =>
  !Number.isFinite(value)
    ? DEFAULT_REVEAL_INTERVAL_MS
    : Math.min(MAX_REVEAL_INTERVAL_MS, Math.max(MIN_REVEAL_INTERVAL_MS, Math.round(value)));

export const DEFAULT_SCORE_EVERY_TURNS = 2;
export const MIN_SCORE_EVERY_TURNS = 1;
export const MAX_SCORE_EVERY_TURNS = 25;
export const SCORE_EVERY_TURNS_OPTIONS = [1, 2, 3, 5, 8] as const;

export const clampScoreEveryTurns = (value: number): number =>
  !Number.isFinite(value)
    ? DEFAULT_SCORE_EVERY_TURNS
    : Math.min(MAX_SCORE_EVERY_TURNS, Math.max(MIN_SCORE_EVERY_TURNS, Math.round(value)));

const RevealIntervalMs = z.number().min(MIN_REVEAL_INTERVAL_MS).max(MAX_REVEAL_INTERVAL_MS);
const ScoreEveryTurns = z.number().int().min(MIN_SCORE_EVERY_TURNS).max(MAX_SCORE_EVERY_TURNS);

export const CreateReplaySchema = z.strictObject({
  callId: z.string().min(1),
  provider: ScoringProviderSchema.optional(),
  intervalMs: RevealIntervalMs.optional(),
  scoreEveryTurns: ScoreEveryTurns.optional(),
});
export type CreateReplayInput = z.infer<typeof CreateReplaySchema>;

// A stream is a call that does not exist yet: its turns arrive over the ingest API.
export const CreateStreamSchema = z.strictObject({
  subject: z.string().trim().min(1).max(120),
  customerName: z.string().trim().min(1).max(60),
  agentName: z.string().trim().min(1).max(60),
  provider: ScoringProviderSchema.optional(),
  scoreEveryTurns: ScoreEveryTurns.optional(),
});
export type CreateStreamInput = z.infer<typeof CreateStreamSchema>;

export const AppendTurnSchema = z.strictObject({
  speaker: z.enum(['employee', 'customer']),
  text: z.string().trim().min(1).max(4000),
  startSeconds: z.number().min(0).optional(),
});
export type AppendTurnInput = z.infer<typeof AppendTurnSchema>;

export const LiveActionSchema = z.enum(['start', 'pause', 'reset', 'pace', 'end']);
export type LiveAction = z.infer<typeof LiveActionSchema>;

export const ControlLiveSchema = z.strictObject({
  action: LiveActionSchema,
  intervalMs: RevealIntervalMs.optional(),
  scoreEveryTurns: ScoreEveryTurns.optional(),
});
export type ControlLiveInput = z.infer<typeof ControlLiveSchema>;

export interface HealthStatus {
  readonly ok: boolean;
  readonly defaultProvider: ScoringProvider;
  readonly providers: Readonly<Record<ScoringProvider, boolean>>;
  // The voice practice call needs a real-time model; it is available when its key is set.
  readonly realtime: {
    readonly available: boolean;
    readonly model: string;
    readonly envVar: string;
  };
}

// ---------------------------------------------------------------------------
// Practice calls: a real-time voice model plays the customer
// ---------------------------------------------------------------------------

export interface PracticeScenario {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly customerName: string;
  readonly subject: string;
}

// Messages on the practice-call WebSocket (/api/practice), in the { event, data } shape
// NestJS gateways route on. Audio travels as base64 PCM16: 16 kHz mono from the browser
// microphone, 24 kHz mono back from the model. Frames are base64 JPEG.
export const PracticeStartSchema = z.strictObject({
  scenarioId: z.string().min(1),
  agentName: z.string().trim().min(1).max(60),
  provider: ScoringProviderSchema.optional(),
  video: z.boolean(),
});
export type PracticeStart = z.infer<typeof PracticeStartSchema>;

export type PracticeClientMessage =
  | { readonly event: 'start'; readonly data: PracticeStart }
  | { readonly event: 'audio'; readonly data: string }
  | { readonly event: 'frame'; readonly data: string }
  | { readonly event: 'end'; readonly data: null };

export type PracticeServerMessage =
  | { readonly event: 'ready'; readonly data: { readonly sessionId: string } }
  | { readonly event: 'audio'; readonly data: string }
  // The model was interrupted: stop playing queued audio.
  | { readonly event: 'interrupted'; readonly data: null }
  | {
      readonly event: 'caption';
      readonly data: { readonly speaker: 'employee' | 'customer'; readonly text: string };
    }
  | { readonly event: 'ended'; readonly data: null }
  | { readonly event: 'error'; readonly data: { readonly message: string } };
