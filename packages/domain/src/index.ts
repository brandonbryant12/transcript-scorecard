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

export const LiveEvaluation = Schema.Struct({
  overallScore: Schema.Number,
  criteria: Schema.Array(CriterionResult),
})
export type LiveEvaluation = typeof LiveEvaluation.Type

export const LiveSnapshot = Schema.Struct({
  sequence: Schema.Number,
  turnCount: Schema.Number,
  overallScore: Schema.Number,
  criteria: Schema.Array(CriterionResult),
  latencyMs: Schema.Number,
  createdAt: Schema.String,
})
export type LiveSnapshot = typeof LiveSnapshot.Type

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
  processingLatencyMs: Schema.NullOr(Schema.Number),
  requestStartedAt: Schema.NullOr(Schema.String),
  requestIndex: Schema.Number,
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
