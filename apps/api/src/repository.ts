import { SqlClient } from "@effect/sql"
import type {
  CallDetail,
  CallSummary,
  Criterion,
  CriterionResult,
  Dashboard,
  Evaluation,
  Run,
  RunCallResult,
  RunDetail,
  LiveSessionDetail,
  LiveEvaluation,
  StartRunInput,
  TranscriptTurn,
  UpdateCriterionInput,
} from "@scorecard/domain"
import {
  clampRevealIntervalMs,
  clampScoreEveryTurns,
  DEFAULT_REVEAL_INTERVAL_MS,
  DEFAULT_SCORE_EVERY_TURNS,
  SYSTEM_ONE_PRICING,
} from "@scorecard/domain"
import { Effect } from "effect"
import { seedCalls, seedCriteria } from "./seed"

type Row = Record<string, unknown>
const rows = (value: unknown): ReadonlyArray<Row> => value as ReadonlyArray<Row>
const now = (): string => new Date().toISOString()

export const initializeDatabase = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const statements = [
    `CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY, customer_name TEXT NOT NULL, agent_name TEXT NOT NULL,
      subject TEXT NOT NULL, started_at TEXT NOT NULL, duration_seconds INTEGER NOT NULL,
      transcript_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT,
      latest_evaluation_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS criteria (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, weight REAL NOT NULL,
      levels_json TEXT NOT NULL, enabled INTEGER NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, status TEXT NOT NULL, total INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS run_calls (
      run_id TEXT NOT NULL, call_id TEXT NOT NULL, status TEXT NOT NULL,
      overall_score REAL, error TEXT, PRIMARY KEY (run_id, call_id)
    )`,
    `CREATE TABLE IF NOT EXISTS run_criteria (
      run_id TEXT NOT NULL, criterion_id TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, weight REAL NOT NULL, levels_json TEXT NOT NULL,
      enabled INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, criterion_id)
    )`,
    `CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL, run_id TEXT NOT NULL,
      overall_score REAL NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL, created_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS criterion_results (
      evaluation_id TEXT NOT NULL, criterion_id TEXT NOT NULL, criterion_name TEXT NOT NULL,
      criterion_description TEXT NOT NULL, weight REAL NOT NULL, levels_json TEXT NOT NULL,
      raw_score REAL NOT NULL, normalized_score REAL NOT NULL, confidence REAL NOT NULL,
      probabilities_json TEXT NOT NULL, evidence_json TEXT,
      PRIMARY KEY (evaluation_id, criterion_id)
    )`,
    `CREATE TABLE IF NOT EXISTS live_sessions (
      id TEXT PRIMARY KEY, call_id TEXT NOT NULL, status TEXT NOT NULL, generation INTEGER NOT NULL,
      criteria_json TEXT NOT NULL, revealed_turn_count INTEGER NOT NULL DEFAULT 0,
      scored_turn_count INTEGER NOT NULL DEFAULT 0, is_processing INTEGER NOT NULL DEFAULT 0,
      elapsed_ms INTEGER NOT NULL DEFAULT 0, processing_latency_ms INTEGER,
      reveal_interval_ms INTEGER NOT NULL DEFAULT 500,
      score_every_turns INTEGER NOT NULL DEFAULT 5,
      request_started_at TEXT, request_index INTEGER NOT NULL DEFAULT 0,
      evaluation_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS live_snapshots (
      session_id TEXT NOT NULL, generation INTEGER NOT NULL, sequence INTEGER NOT NULL,
      turn_count INTEGER NOT NULL, evaluation_json TEXT NOT NULL, latency_ms INTEGER NOT NULL,
      model TEXT, input_tokens INTEGER, output_tokens INTEGER, estimated_cost_usd REAL,
      created_at TEXT NOT NULL, PRIMARY KEY (session_id, generation, sequence)
    )`,
  ]
  for (const statement of statements) yield* sql.unsafe(statement)
  const liveColumns = rows(yield* sql.unsafe("PRAGMA table_info(live_sessions)"))
  if (!liveColumns.some(({ name }) => name === "request_started_at")) {
    yield* sql.unsafe("ALTER TABLE live_sessions ADD COLUMN request_started_at TEXT")
  }
  if (!liveColumns.some(({ name }) => name === "request_index")) {
    yield* sql.unsafe("ALTER TABLE live_sessions ADD COLUMN request_index INTEGER NOT NULL DEFAULT 0")
  }
  if (!liveColumns.some(({ name }) => name === "reveal_interval_ms")) {
    yield* sql.unsafe("ALTER TABLE live_sessions ADD COLUMN reveal_interval_ms INTEGER NOT NULL DEFAULT 500")
  }
  if (!liveColumns.some(({ name }) => name === "score_every_turns")) {
    yield* sql.unsafe("ALTER TABLE live_sessions ADD COLUMN score_every_turns INTEGER NOT NULL DEFAULT 5")
  }
  const snapshotColumns = rows(yield* sql.unsafe("PRAGMA table_info(live_snapshots)"))
  if (!snapshotColumns.some(({ name }) => name === "model")) {
    yield* sql.unsafe("ALTER TABLE live_snapshots ADD COLUMN model TEXT")
  }
  if (!snapshotColumns.some(({ name }) => name === "input_tokens")) {
    yield* sql.unsafe("ALTER TABLE live_snapshots ADD COLUMN input_tokens INTEGER")
  }
  if (!snapshotColumns.some(({ name }) => name === "output_tokens")) {
    yield* sql.unsafe("ALTER TABLE live_snapshots ADD COLUMN output_tokens INTEGER")
  }
  if (!snapshotColumns.some(({ name }) => name === "estimated_cost_usd")) {
    yield* sql.unsafe("ALTER TABLE live_snapshots ADD COLUMN estimated_cost_usd REAL")
  }

  // A process exit during a demo run must not leave permanently "processing" data.
  yield* sql`UPDATE calls SET status = 'pending', error = NULL WHERE status = 'processing'`
  yield* sql`UPDATE runs SET status = 'failed', completed_at = ${now()} WHERE status IN ('queued', 'running')`
  yield* sql`UPDATE live_sessions
    SET status = CASE WHEN status = 'playing' THEN 'paused' ELSE status END,
      is_processing = 0, request_started_at = NULL, updated_at = ${now()}
    WHERE status = 'playing' OR is_processing = 1`

  for (const call of seedCalls) {
    yield* sql`INSERT OR IGNORE INTO calls
      (id, customer_name, agent_name, subject, started_at, duration_seconds, transcript_json, status)
      VALUES (${call.id}, ${call.customerName}, ${call.agentName}, ${call.subject}, ${call.startedAt},
        ${call.durationSeconds}, ${JSON.stringify(call.transcript)}, 'pending')`
  }
  for (const criterion of seedCriteria) {
    yield* sql`INSERT OR IGNORE INTO criteria
      (id, name, description, weight, levels_json, enabled, updated_at)
      VALUES (${criterion.id}, ${criterion.name}, ${criterion.description}, ${criterion.weight},
        ${JSON.stringify(criterion.levels)}, ${criterion.enabled ? 1 : 0}, ${criterion.updatedAt})`
  }
})

const criterionFromRow = (row: Row): Criterion => ({
  id: String(row.id),
  name: String(row.name),
  description: String(row.description),
  weight: Number(row.weight),
  levels: JSON.parse(String(row.levels_json)) as ReadonlyArray<string>,
  enabled: Boolean(row.enabled),
  updatedAt: String(row.updated_at),
})

const runFromRow = (row: Row): Run => ({
  id: String(row.id),
  status: String(row.status) as Run["status"],
  total: Number(row.total),
  completed: Number(row.completed),
  failed: Number(row.failed),
  createdAt: String(row.created_at),
  startedAt: row.started_at == null ? null : String(row.started_at),
  completedAt: row.completed_at == null ? null : String(row.completed_at),
})

const callSummaryFromRow = (row: Row): CallSummary => ({
  id: String(row.id),
  customerName: String(row.customer_name),
  agentName: String(row.agent_name),
  subject: String(row.subject),
  startedAt: String(row.started_at),
  durationSeconds: Number(row.duration_seconds),
  status: String(row.status) as CallSummary["status"],
  overallScore: row.overall_score == null ? null : Number(row.overall_score),
  error: row.error == null ? null : String(row.error),
})

export const listCriteria = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return rows(yield* sql`SELECT * FROM criteria ORDER BY rowid`).map(criterionFromRow)
})

export const updateCriterion = (id: string, input: UpdateCriterionInput) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const existing = rows(yield* sql`SELECT * FROM criteria WHERE id = ${id}`)[0]
    if (!existing) return null
    const criterion = criterionFromRow(existing)
    const next: Criterion = {
      ...criterion,
      ...input,
      levels: input.levels ?? criterion.levels,
      updatedAt: now(),
    }
    yield* sql`UPDATE criteria SET name = ${next.name}, description = ${next.description},
      weight = ${next.weight}, levels_json = ${JSON.stringify(next.levels)},
      enabled = ${next.enabled ? 1 : 0}, updated_at = ${next.updatedAt} WHERE id = ${id}`
    return next
  })

export const listCalls = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return rows(yield* sql`SELECT c.*, e.overall_score
    FROM calls c LEFT JOIN evaluations e ON e.id = c.latest_evaluation_id
    ORDER BY c.started_at DESC`).map(callSummaryFromRow)
})

const evaluationFor = (evaluationId: string | null) =>
  Effect.gen(function* () {
    if (!evaluationId) return null
    const sql = yield* SqlClient.SqlClient
    const evaluationRow = rows(yield* sql`SELECT * FROM evaluations WHERE id = ${evaluationId}`)[0]
    if (!evaluationRow) return null
    const resultRows = rows(
      yield* sql`SELECT * FROM criterion_results WHERE evaluation_id = ${evaluationId} ORDER BY rowid`,
    )
    const criteria: ReadonlyArray<CriterionResult> = resultRows.map((row) => ({
      criterionId: String(row.criterion_id),
      criterionName: String(row.criterion_name),
      criterionDescription: String(row.criterion_description),
      weight: Number(row.weight),
      levels: JSON.parse(String(row.levels_json)) as ReadonlyArray<string>,
      rawScore: Number(row.raw_score),
      normalizedScore: Number(row.normalized_score),
      confidence: Number(row.confidence),
      probabilities: JSON.parse(String(row.probabilities_json)) as Record<string, number>,
      evidence: row.evidence_json == null ? null : JSON.parse(String(row.evidence_json)),
    }))
    return {
      id: String(evaluationRow.id),
      callId: String(evaluationRow.call_id),
      runId: String(evaluationRow.run_id),
      overallScore: Number(evaluationRow.overall_score),
      model: String(evaluationRow.model),
      inputTokens: Number(evaluationRow.input_tokens),
      outputTokens: Number(evaluationRow.output_tokens),
      createdAt: String(evaluationRow.created_at),
      criteria,
    } satisfies Evaluation
  })

export const getCall = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT c.*, e.overall_score FROM calls c
      LEFT JOIN evaluations e ON e.id = c.latest_evaluation_id WHERE c.id = ${id}`)[0]
    if (!row) return null
    const evaluation = yield* evaluationFor(row.latest_evaluation_id == null ? null : String(row.latest_evaluation_id))
    return {
      ...callSummaryFromRow(row),
      transcript: JSON.parse(String(row.transcript_json)) as ReadonlyArray<TranscriptTurn>,
      evaluation,
    } satisfies CallDetail
  })

export const getDashboard = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const aggregate = rows(yield* sql`SELECT COUNT(*) total_calls,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) evaluated_calls,
      SUM(CASE WHEN status IN ('pending', 'processing') THEN 1 ELSE 0 END) pending_calls,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) failed_calls
    FROM calls`)[0]!
  const score = rows(yield* sql`SELECT AVG(overall_score) average_score FROM evaluations e
    JOIN calls c ON c.latest_evaluation_id = e.id`)[0]!
  const latest = rows(yield* sql`SELECT * FROM runs ORDER BY created_at DESC LIMIT 1`)[0]
  return {
    totalCalls: Number(aggregate.total_calls ?? 0),
    evaluatedCalls: Number(aggregate.evaluated_calls ?? 0),
    pendingCalls: Number(aggregate.pending_calls ?? 0),
    failedCalls: Number(aggregate.failed_calls ?? 0),
    averageScore: Math.round(Number(score.average_score ?? 0) * 10) / 10,
    latestRun: latest ? runFromRow(latest) : null,
  } satisfies Dashboard
})

export const createRun = (input: StartRunInput) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const available = yield* listCalls
    const ids = input.callIds?.length ? [...new Set(input.callIds)] : available.map(({ id }) => id)
    const known = new Set(available.map(({ id }) => id))
    if (ids.length === 0) return { error: "No calls selected" } as const
    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length) return { error: `Unknown call IDs: ${unknown.join(", ")}` } as const
    const criteria = yield* listCriteria
    if (!criteria.some(({ enabled }) => enabled)) return { error: "At least one criterion must be enabled" } as const
    const id = `run-${crypto.randomUUID()}`
    const createdAt = now()
    yield* sql`INSERT INTO runs (id, status, total, completed, failed, created_at)
      VALUES (${id}, 'queued', ${ids.length}, 0, 0, ${createdAt})`
    for (const criterion of criteria) {
      yield* sql`INSERT INTO run_criteria
        (run_id, criterion_id, name, description, weight, levels_json, enabled, updated_at)
        VALUES (${id}, ${criterion.id}, ${criterion.name}, ${criterion.description}, ${criterion.weight},
          ${JSON.stringify(criterion.levels)}, ${criterion.enabled ? 1 : 0}, ${criterion.updatedAt})`
    }
    for (const callId of ids) {
      yield* sql`INSERT INTO run_calls (run_id, call_id, status) VALUES (${id}, ${callId}, 'pending')`
    }
    return { run: { id, status: "queued", total: ids.length, completed: 0, failed: 0, createdAt, startedAt: null, completedAt: null } satisfies Run, callIds: ids } as const
  })

export const getRunCriteria = (runId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return rows(yield* sql`SELECT criterion_id id, name, description, weight, levels_json, enabled, updated_at
      FROM run_criteria WHERE run_id = ${runId} ORDER BY rowid`).map(criterionFromRow)
  })

export const getRun = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT * FROM runs WHERE id = ${id}`)[0]
    if (!row) return null
    const results: ReadonlyArray<RunCallResult> = rows(
      yield* sql`SELECT * FROM run_calls WHERE run_id = ${id} ORDER BY rowid`,
    ).map((result) => ({
      callId: String(result.call_id),
      status: String(result.status) as RunCallResult["status"],
      overallScore: result.overall_score == null ? null : Number(result.overall_score),
      error: result.error == null ? null : String(result.error),
    }))
    return { ...runFromRow(row), results } satisfies RunDetail
  })

export const markRunStarted = (runId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE runs SET status = 'running', started_at = ${now()} WHERE id = ${runId}`
  })

export const markCallProcessing = (runId: string, callId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE calls SET status = 'processing', error = NULL WHERE id = ${callId}`
    yield* sql`UPDATE run_calls SET status = 'processing', error = NULL WHERE run_id = ${runId} AND call_id = ${callId}`
  })

export const saveEvaluation = (evaluation: Evaluation) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`INSERT INTO evaluations
      (id, call_id, run_id, overall_score, model, input_tokens, output_tokens, created_at)
      VALUES (${evaluation.id}, ${evaluation.callId}, ${evaluation.runId}, ${evaluation.overallScore},
        ${evaluation.model}, ${evaluation.inputTokens}, ${evaluation.outputTokens}, ${evaluation.createdAt})`
    for (const result of evaluation.criteria) {
      yield* sql`INSERT INTO criterion_results
        (evaluation_id, criterion_id, criterion_name, criterion_description, weight, levels_json,
          raw_score, normalized_score, confidence, probabilities_json, evidence_json)
        VALUES (${evaluation.id}, ${result.criterionId}, ${result.criterionName},
          ${result.criterionDescription}, ${result.weight}, ${JSON.stringify(result.levels)},
          ${result.rawScore}, ${result.normalizedScore}, ${result.confidence},
          ${JSON.stringify(result.probabilities)}, ${result.evidence ? JSON.stringify(result.evidence) : null})`
    }
    yield* sql`UPDATE calls SET status = 'completed', error = NULL, latest_evaluation_id = ${evaluation.id}
      WHERE id = ${evaluation.callId}`
    yield* sql`UPDATE run_calls SET status = 'completed', overall_score = ${evaluation.overallScore}, error = NULL
      WHERE run_id = ${evaluation.runId} AND call_id = ${evaluation.callId}`
    yield* sql`UPDATE runs SET completed = completed + 1 WHERE id = ${evaluation.runId}`
  })

export const markCallFailed = (runId: string, callId: string, error: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE calls SET status = 'failed', error = ${error} WHERE id = ${callId}`
    yield* sql`UPDATE run_calls SET status = 'failed', error = ${error}
      WHERE run_id = ${runId} AND call_id = ${callId}`
    yield* sql`UPDATE runs SET completed = completed + 1, failed = failed + 1 WHERE id = ${runId}`
  })

export const finishRun = (runId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT total, completed, failed FROM runs WHERE id = ${runId}`)[0]!
    const failed = Number(row.failed)
    const completed = Number(row.completed)
    const total = Number(row.total)
    const status = failed === total ? "failed" : failed > 0 ? "completed_with_errors" : "completed"
    yield* sql`UPDATE runs SET status = ${status}, completed_at = ${now()} WHERE id = ${runId}`
    // Defensive consistency if a caller cancelled its worker mid-flight.
    if (completed < total) yield* sql`UPDATE runs SET status = 'failed' WHERE id = ${runId}`
  })

export const createLiveSession = (
  callId: string,
  intervalMs = DEFAULT_REVEAL_INTERVAL_MS,
  scoreEveryTurns = DEFAULT_SCORE_EVERY_TURNS,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const call = rows(yield* sql`SELECT id FROM calls WHERE id = ${callId}`)[0]
    if (!call) return null
    const criteria = yield* listCriteria
    if (!criteria.some(({ enabled }) => enabled)) return null
    const id = `live-${crypto.randomUUID()}`
    const timestamp = now()
    yield* sql`INSERT INTO live_sessions
      (id, call_id, status, generation, criteria_json, reveal_interval_ms, score_every_turns,
        created_at, updated_at)
      VALUES (${id}, ${callId}, 'ready', 1, ${JSON.stringify(criteria)},
        ${clampRevealIntervalMs(intervalMs)}, ${clampScoreEveryTurns(scoreEveryTurns)},
        ${timestamp}, ${timestamp})`
    return yield* getLiveSession(id)
  })

export const getLiveCriteria = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT criteria_json FROM live_sessions WHERE id = ${id}`)[0]
    return row ? (JSON.parse(String(row.criteria_json)) as ReadonlyArray<Criterion>) : null
  })

export const getLiveSession = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT s.*, c.transcript_json FROM live_sessions s
      JOIN calls c ON c.id = s.call_id WHERE s.id = ${id}`)[0]
    if (!row) return null
    const generation = Number(row.generation)
    const allTurns = JSON.parse(String(row.transcript_json)) as ReadonlyArray<TranscriptTurn>
    const revealed = Number(row.revealed_turn_count)
    const snapshotRows = rows(yield* sql`SELECT * FROM live_snapshots
      WHERE session_id = ${id} AND generation = ${generation} ORDER BY sequence`)
    const snapshots = snapshotRows.map((snapshot) => {
      const evaluation = JSON.parse(String(snapshot.evaluation_json)) as LiveEvaluation
      return {
        sequence: Number(snapshot.sequence),
        turnCount: Number(snapshot.turn_count),
        overallScore: evaluation.overallScore,
        criteria: evaluation.criteria,
        signals: evaluation.signals ?? null,
        latencyMs: Number(snapshot.latency_ms),
        model: snapshot.model == null ? null : String(snapshot.model),
        inputTokens: snapshot.input_tokens == null ? null : Number(snapshot.input_tokens),
        outputTokens: snapshot.output_tokens == null ? null : Number(snapshot.output_tokens),
        estimatedCostUsd:
          snapshot.estimated_cost_usd == null ? null : Number(snapshot.estimated_cost_usd),
        createdAt: String(snapshot.created_at),
      }
    })
    const costedSnapshots = snapshots.filter(
      (snapshot) =>
        snapshot.inputTokens !== null &&
        snapshot.outputTokens !== null &&
        snapshot.estimatedCostUsd !== null,
    )
    const hasUnknownCost = costedSnapshots.length !== snapshots.length
    const totalInputTokens = costedSnapshots.reduce((sum, snapshot) => sum + snapshot.inputTokens!, 0)
    const totalOutputTokens = costedSnapshots.reduce((sum, snapshot) => sum + snapshot.outputTokens!, 0)
    const totalEstimatedCostUsd = costedSnapshots.reduce(
      (sum, snapshot) => sum + snapshot.estimatedCostUsd!,
      0,
    )
    return {
      id: String(row.id),
      callId: String(row.call_id),
      status: String(row.status) as LiveSessionDetail["status"],
      generation,
      revealedTurnCount: revealed,
      totalTurns: allTurns.length,
      scoredTurnCount: Number(row.scored_turn_count),
      pendingTurnCount: Math.max(0, revealed - Number(row.scored_turn_count)),
      isProcessing: Boolean(row.is_processing),
      elapsedMs: Number(row.elapsed_ms),
      revealIntervalMs: Number(row.reveal_interval_ms),
      scoreEveryTurns: Number(row.score_every_turns),
      processingLatencyMs: row.processing_latency_ms == null ? null : Number(row.processing_latency_ms),
      requestStartedAt: row.request_started_at == null ? null : String(row.request_started_at),
      requestIndex: Number(row.request_index),
      totalInputTokens,
      totalOutputTokens,
      totalEstimatedCostUsd,
      costCoverage:
        snapshots.length === 0 || costedSnapshots.length === 0
          ? "none"
          : hasUnknownCost || String(row.status) === "failed"
            ? "partial"
            : "complete",
      pricing: SYSTEM_ONE_PRICING,
      transcript: allTurns.slice(0, revealed),
      evaluation: row.evaluation_json == null ? null : JSON.parse(String(row.evaluation_json)),
      snapshots,
      updatedAt: String(row.updated_at),
      error: row.error == null ? null : String(row.error),
    } satisfies LiveSessionDetail
  })

export const setLivePacing = (
  id: string,
  pacing: { readonly intervalMs?: number | undefined; readonly scoreEveryTurns?: number | undefined },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (pacing.intervalMs !== undefined) {
      yield* sql`UPDATE live_sessions SET reveal_interval_ms = ${clampRevealIntervalMs(pacing.intervalMs)},
        updated_at = ${now()} WHERE id = ${id}`
    }
    if (pacing.scoreEveryTurns !== undefined) {
      yield* sql`UPDATE live_sessions SET score_every_turns = ${clampScoreEveryTurns(pacing.scoreEveryTurns)},
        updated_at = ${now()} WHERE id = ${id}`
    }
    return yield* getLiveSession(id)
  })

export const setLiveStatus = (id: string, status: "playing" | "paused") =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE live_sessions SET status = ${status}, updated_at = ${now()}, error = NULL
      WHERE id = ${id} AND status NOT IN ('completed', 'failed')`
    return yield* getLiveSession(id)
  })

export const revealLiveTurn = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const row = rows(yield* sql`SELECT s.revealed_turn_count, s.reveal_interval_ms, c.transcript_json
      FROM live_sessions s JOIN calls c ON c.id = s.call_id WHERE s.id = ${id} AND s.status = 'playing'`)[0]
    if (!row) return yield* getLiveSession(id)
    const total = (JSON.parse(String(row.transcript_json)) as ReadonlyArray<TranscriptTurn>).length
    const revealed = Number(row.revealed_turn_count)
    if (revealed >= total) return yield* getLiveSession(id)
    // Accumulate rather than multiply, so a pace change mid-replay keeps elapsed honest.
    yield* sql`UPDATE live_sessions SET revealed_turn_count = ${revealed + 1},
      elapsed_ms = elapsed_ms + ${Number(row.reveal_interval_ms)},
      updated_at = ${now()} WHERE id = ${id} AND status = 'playing'`
    return yield* getLiveSession(id)
  })

export const beginLiveScoring = (id: string, generation: number, requestStartedAt = now()) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE live_sessions SET is_processing = 1, request_started_at = ${requestStartedAt},
      request_index = request_index + 1, updated_at = ${requestStartedAt}
      WHERE id = ${id} AND generation = ${generation}`
  })

export const saveLiveSnapshot = (
  id: string,
  generation: number,
  turnCount: number,
  evaluation: LiveEvaluation,
  latencyMs: number,
  provider: {
    readonly model: string
    readonly inputTokens: number
    readonly outputTokens: number
    readonly estimatedCostUsd: number
  } | null = null,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const current = rows(yield* sql`SELECT s.generation, s.status, c.transcript_json,
      (SELECT COUNT(*) FROM live_snapshots x WHERE x.session_id = s.id AND x.generation = s.generation) sequence
      FROM live_sessions s JOIN calls c ON c.id = s.call_id WHERE s.id = ${id}`)[0]
    if (!current || Number(current.generation) !== generation) return false
    const total = (JSON.parse(String(current.transcript_json)) as ReadonlyArray<TranscriptTurn>).length
    const sequence = Number(current.sequence) + 1
    const timestamp = now()
    yield* sql`INSERT INTO live_snapshots
      (session_id, generation, sequence, turn_count, evaluation_json, latency_ms,
        model, input_tokens, output_tokens, estimated_cost_usd, created_at)
      VALUES (${id}, ${generation}, ${sequence}, ${turnCount}, ${JSON.stringify(evaluation)}, ${latencyMs},
        ${provider?.model ?? null}, ${provider?.inputTokens ?? null}, ${provider?.outputTokens ?? null},
        ${provider?.estimatedCostUsd ?? null}, ${timestamp})`
    const isFinal = turnCount >= total
    yield* sql`UPDATE live_sessions SET scored_turn_count = ${turnCount}, is_processing = 0,
      processing_latency_ms = ${latencyMs}, evaluation_json = ${JSON.stringify(evaluation)},
      request_started_at = NULL,
      status = ${isFinal ? "completed" : String(current.status)}, updated_at = ${timestamp}, error = NULL
      WHERE id = ${id} AND generation = ${generation}`
    return true
  })

export const failLiveScoring = (
  id: string,
  generation: number,
  error: string,
  processingLatencyMs: number | null = null,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE live_sessions SET status = 'failed', is_processing = 0, error = ${error},
      request_started_at = NULL, processing_latency_ms = ${processingLatencyMs},
      updated_at = ${now()} WHERE id = ${id} AND generation = ${generation}`
  })

export const resetLiveSession = (id: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`UPDATE live_sessions SET status = 'ready', generation = generation + 1,
      revealed_turn_count = 0, scored_turn_count = 0, is_processing = 0, elapsed_ms = 0,
      processing_latency_ms = NULL, evaluation_json = NULL, updated_at = ${now()}, error = NULL
      , request_started_at = NULL, request_index = 0
      WHERE id = ${id}`
    return yield* getLiveSession(id)
  })
