import { Schema } from "effect"

export const Speaker = Schema.Literal("employee", "customer")
export type Speaker = typeof Speaker.Type

export const CallStatus = Schema.Literal("pending", "processing", "completed", "failed")
export type CallStatus = typeof CallStatus.Type

export const RunStatus = Schema.Literal(
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
)
export type RunStatus = typeof RunStatus.Type

export const TranscriptTurn = Schema.Struct({
  id: Schema.String,
  speaker: Speaker,
  text: Schema.String,
  startSeconds: Schema.Number,
})
export type TranscriptTurn = typeof TranscriptTurn.Type

export const Criterion = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  weight: Schema.Number,
  levels: Schema.Array(Schema.String),
  enabled: Schema.Boolean,
  updatedAt: Schema.String,
})
export type Criterion = typeof Criterion.Type

export const Evidence = Schema.Struct({
  turnId: Schema.String,
  speaker: Speaker,
  text: Schema.String,
})
export type Evidence = typeof Evidence.Type

export const CriterionResult = Schema.Struct({
  criterionId: Schema.String,
  criterionName: Schema.String,
  criterionDescription: Schema.String,
  weight: Schema.Number,
  levels: Schema.Array(Schema.String),
  rawScore: Schema.Number,
  normalizedScore: Schema.Number,
  confidence: Schema.Number,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  evidence: Schema.NullOr(Evidence),
})
export type CriterionResult = typeof CriterionResult.Type

export const Evaluation = Schema.Struct({
  id: Schema.String,
  callId: Schema.String,
  runId: Schema.String,
  overallScore: Schema.Number,
  model: Schema.String,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  // Server-measured SDK round trip; null for evaluations stored before it was recorded.
  latencyMs: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
  criteria: Schema.Array(CriterionResult),
})
export type Evaluation = typeof Evaluation.Type

export const CallSummary = Schema.Struct({
  id: Schema.String,
  customerName: Schema.String,
  agentName: Schema.String,
  subject: Schema.String,
  startedAt: Schema.String,
  durationSeconds: Schema.Number,
  status: CallStatus,
  overallScore: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
  latencyMs: Schema.NullOr(Schema.Number),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  estimatedCostUsd: Schema.NullOr(Schema.Number),
  model: Schema.NullOr(Schema.String),
  evaluatedAt: Schema.NullOr(Schema.String),
})
export type CallSummary = typeof CallSummary.Type

export const CallDetail = Schema.Struct({
  ...CallSummary.fields,
  transcript: Schema.Array(TranscriptTurn),
  evaluation: Schema.NullOr(Evaluation),
})
export type CallDetail = typeof CallDetail.Type

export const Run = Schema.Struct({
  id: Schema.String,
  status: RunStatus,
  total: Schema.Number,
  completed: Schema.Number,
  failed: Schema.Number,
  createdAt: Schema.String,
  startedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
})
export type Run = typeof Run.Type

export const RunCallResult = Schema.Struct({
  callId: Schema.String,
  status: CallStatus,
  overallScore: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
})
export type RunCallResult = typeof RunCallResult.Type

export const RunDetail = Schema.Struct({
  ...Run.fields,
  results: Schema.Array(RunCallResult),
})
export type RunDetail = typeof RunDetail.Type

export const Dashboard = Schema.Struct({
  totalCalls: Schema.Number,
  evaluatedCalls: Schema.Number,
  pendingCalls: Schema.Number,
  failedCalls: Schema.Number,
  averageScore: Schema.Number,
  latestRun: Schema.NullOr(Run),
})
export type Dashboard = typeof Dashboard.Type

export const LiveStatus = Schema.Literal("ready", "playing", "paused", "completed", "failed")
export type LiveStatus = typeof LiveStatus.Type

// Observational signals that ride along with a scoring request. They are deliberately
// excluded from the weighted score: they describe the call, they do not grade it.
export const EMOTION_LABELS = [
  "frustrated",
  "anxious",
  "skeptical",
  "cooperative",
  "reassured",
  "neutral",
] as const
export type EmotionLabel = (typeof EMOTION_LABELS)[number]

export const EmotionSignal = Schema.Struct({
  label: Schema.String,
  confidence: Schema.Number,
  probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
})
export type EmotionSignal = typeof EmotionSignal.Type

export const CallSignals = Schema.Struct({
  // Probability that the employee restated the customer's problem back to them.
  restatedProblem: Schema.Number,
  emotion: EmotionSignal,
})
export type CallSignals = typeof CallSignals.Type

export const LiveEvaluation = Schema.Struct({
  overallScore: Schema.Number,
  criteria: Schema.Array(CriterionResult),
  signals: Schema.NullOr(CallSignals),
})
export type LiveEvaluation = typeof LiveEvaluation.Type

export const SYSTEM_ONE_PRICING = {
  inputUsdPerMillion: 0.042,
  outputUsdPerMillion: 0,
  currency: "USD",
  sourceUrl: "https://typesafe.ai/blog/introducing-system-one-models-and-jev",
  checkedAt: "2026-09-16",
} as const

export const estimateSystemOneCostUsd = (inputTokens: number, outputTokens: number): number =>
  (inputTokens * SYSTEM_ONE_PRICING.inputUsdPerMillion +
    outputTokens * SYSTEM_ONE_PRICING.outputUsdPerMillion) /
  1_000_000

export const LiveSnapshot = Schema.Struct({
  sequence: Schema.Number,
  turnCount: Schema.Number,
  overallScore: Schema.Number,
  criteria: Schema.Array(CriterionResult),
  signals: Schema.NullOr(CallSignals),
  latencyMs: Schema.Number,
  model: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  estimatedCostUsd: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
})
export type LiveSnapshot = typeof LiveSnapshot.Type

// Two independent knobs. The transcript reveals one turn per interval so the replay
// reads quickly, while rescoring batches: a request goes out once this many turns have
// accumulated unscored, keeping provider calls well below one per turn.
export const DEFAULT_REVEAL_INTERVAL_MS = 500
export const MIN_REVEAL_INTERVAL_MS = 250
export const MAX_REVEAL_INTERVAL_MS = 30_000

export const REVEAL_INTERVAL_OPTIONS = [250, 500, 1_000, 2_000, 5_000] as const

export const clampRevealIntervalMs = (value: number): number =>
  !Number.isFinite(value)
    ? DEFAULT_REVEAL_INTERVAL_MS
    : Math.min(MAX_REVEAL_INTERVAL_MS, Math.max(MIN_REVEAL_INTERVAL_MS, Math.round(value)))

export const DEFAULT_SCORE_EVERY_TURNS = 5
export const MIN_SCORE_EVERY_TURNS = 1
export const MAX_SCORE_EVERY_TURNS = 25

export const SCORE_EVERY_TURNS_OPTIONS = [1, 2, 3, 5, 8, 10, 15] as const

export const clampScoreEveryTurns = (value: number): number =>
  !Number.isFinite(value)
    ? DEFAULT_SCORE_EVERY_TURNS
    : Math.min(MAX_SCORE_EVERY_TURNS, Math.max(MIN_SCORE_EVERY_TURNS, Math.round(value)))

export const LiveSessionDetail = Schema.Struct({
  id: Schema.String,
  callId: Schema.String,
  status: LiveStatus,
  generation: Schema.Number,
  revealedTurnCount: Schema.Number,
  totalTurns: Schema.Number,
  scoredTurnCount: Schema.Number,
  pendingTurnCount: Schema.Number,
  isProcessing: Schema.Boolean,
  elapsedMs: Schema.Number,
  revealIntervalMs: Schema.Number,
  scoreEveryTurns: Schema.Number,
  processingLatencyMs: Schema.NullOr(Schema.Number),
  requestStartedAt: Schema.NullOr(Schema.String),
  requestIndex: Schema.Number,
  totalInputTokens: Schema.Number,
  totalOutputTokens: Schema.Number,
  totalEstimatedCostUsd: Schema.Number,
  costCoverage: Schema.Literal("complete", "partial", "none"),
  pricing: Schema.Struct({
    inputUsdPerMillion: Schema.Number,
    outputUsdPerMillion: Schema.Number,
    currency: Schema.Literal("USD"),
    sourceUrl: Schema.String,
    checkedAt: Schema.String,
  }),
  transcript: Schema.Array(TranscriptTurn),
  evaluation: Schema.NullOr(LiveEvaluation),
  snapshots: Schema.Array(LiveSnapshot),
  updatedAt: Schema.String,
  error: Schema.NullOr(Schema.String),
})
export type LiveSessionDetail = typeof LiveSessionDetail.Type

export interface UpdateCriterionInput {
  readonly name?: string
  readonly description?: string
  readonly weight?: number
  readonly levels?: ReadonlyArray<string>
  readonly enabled?: boolean
}

export interface StartRunInput {
  readonly callIds?: ReadonlyArray<string>
}

export const computeWeightedScore = (
  results: ReadonlyArray<{ readonly rawScore: number; readonly maxScore: number; readonly weight: number }>,
): number => {
  const active = results.filter(({ maxScore, weight }) => maxScore > 0 && weight > 0)
  const denominator = active.reduce((sum, result) => sum + result.weight, 0)
  if (denominator === 0) return 0
  const score = active.reduce(
    (sum, result) => sum + (result.rawScore / result.maxScore) * result.weight,
    0,
  )
  return Math.round((score / denominator) * 1000) / 10
}
