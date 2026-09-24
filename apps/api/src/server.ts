import type { IncomingMessage, ServerResponse } from "node:http"
import type { SqlClient } from "@effect/sql"
import type { StartRunInput, UpdateCriterionInput } from "@scorecard/domain"
import {
  MAX_REVEAL_INTERVAL_MS,
  MAX_SCORE_EVERY_TURNS,
  MIN_REVEAL_INTERVAL_MS,
  MIN_SCORE_EVERY_TURNS,
} from "@scorecard/domain"
import { Either, Schema, type Effect } from "effect"
import {
  createRun,
  getCall,
  getDashboard,
  getRun,
  listCalls,
  listCriteria,
  updateCriterion,
} from "./repository"
import { processRun } from "./runner"
import { makeLiveCoordinator } from "./live"

interface ApiRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>
  readonly runFork: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => void
}

type Worker = (runId: string, callIds: ReadonlyArray<string>) => void

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  })
  response.end(JSON.stringify(body))
}

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > 64_000) throw new Error("Request body is too large")
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

const NonEmptyString = Schema.String.pipe(Schema.minLength(1))
const UpdateCriterion = Schema.Struct({
  name: Schema.optional(NonEmptyString),
  description: Schema.optional(NonEmptyString),
  weight: Schema.optional(Schema.Number.pipe(Schema.between(0, 100))),
  levels: Schema.optional(Schema.Array(NonEmptyString).pipe(Schema.minItems(2))),
  enabled: Schema.optional(Schema.Boolean),
})
const StartRun = Schema.Struct({
  callIds: Schema.optional(Schema.Array(NonEmptyString)),
})
const RevealIntervalMs = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(MIN_REVEAL_INTERVAL_MS),
  Schema.lessThanOrEqualTo(MAX_REVEAL_INTERVAL_MS),
)
const ScoreEveryTurns = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(MIN_SCORE_EVERY_TURNS),
  Schema.lessThanOrEqualTo(MAX_SCORE_EVERY_TURNS),
)
const CreateLive = Schema.Struct({
  callId: NonEmptyString,
  intervalMs: Schema.optional(RevealIntervalMs),
  scoreEveryTurns: Schema.optional(ScoreEveryTurns),
})
const ControlLive = Schema.Struct({
  action: Schema.Literal("start", "pause", "reset", "pace"),
  intervalMs: Schema.optional(RevealIntervalMs),
  scoreEveryTurns: Schema.optional(ScoreEveryTurns),
})

const validateCriterion = (body: unknown): UpdateCriterionInput | string => {
  const decoded = Schema.decodeUnknownEither(UpdateCriterion)(body)
  if (Either.isLeft(decoded)) return "Invalid criterion update"
  const value = decoded.right
  return {
    ...(value.name === undefined ? {} : { name: value.name }),
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(value.weight === undefined ? {} : { weight: value.weight }),
    ...(value.levels === undefined ? {} : { levels: value.levels }),
    ...(value.enabled === undefined ? {} : { enabled: value.enabled }),
  }
}

const validateRun = (body: unknown): StartRunInput | string => {
  const decoded = Schema.decodeUnknownEither(StartRun)(body)
  if (Either.isLeft(decoded)) return "Invalid run request"
  return decoded.right.callIds === undefined ? {} : { callIds: decoded.right.callIds }
}

export const makeRequestHandler = (
  runtime: ApiRuntime,
  apiKey: string | undefined,
  worker?: Worker,
  registerDispose?: (dispose: () => void) => void,
) => {
  const startWorker: Worker = worker ?? ((runId, callIds) => {
    if (!apiKey) return
    runtime.runFork(processRun(runId, callIds, apiKey))
  })
  const live = apiKey ? makeLiveCoordinator(runtime, apiKey) : null
  registerDispose?.(() => live?.dispose())

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const method = request.method ?? "GET"
    const url = new URL(request.url ?? "/", "http://localhost")
    try {
      if (method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, { ok: true, classifierConfigured: Boolean(apiKey) })
      }
      if (method === "GET" && url.pathname === "/api/dashboard") {
        return json(response, 200, await runtime.runPromise(getDashboard))
      }
      if (method === "GET" && url.pathname === "/api/calls") {
        return json(response, 200, await runtime.runPromise(listCalls))
      }
      const callMatch = url.pathname.match(/^\/api\/calls\/([^/]+)$/)
      if (method === "GET" && callMatch) {
        const call = await runtime.runPromise(getCall(decodeURIComponent(callMatch[1]!)))
        return call ? json(response, 200, call) : json(response, 404, { error: "Call not found" })
      }
      if (method === "GET" && url.pathname === "/api/criteria") {
        return json(response, 200, await runtime.runPromise(listCriteria))
      }
      const criterionMatch = url.pathname.match(/^\/api\/criteria\/([^/]+)$/)
      if (method === "PUT" && criterionMatch) {
        const validated = validateCriterion(await readJson(request))
        if (typeof validated === "string") return json(response, 400, { error: validated })
        const criterion = await runtime.runPromise(
          updateCriterion(decodeURIComponent(criterionMatch[1]!), validated),
        )
        return criterion
          ? json(response, 200, criterion)
          : json(response, 404, { error: "Criterion not found" })
      }
      if (method === "POST" && url.pathname === "/api/runs") {
        if (!apiKey) return json(response, 503, { error: "JEV_API_KEY is not configured on the API server" })
        const validated = validateRun(await readJson(request))
        if (typeof validated === "string") return json(response, 400, { error: validated })
        const created = await runtime.runPromise(createRun(validated))
        if ("error" in created) return json(response, 400, { error: created.error })
        startWorker(created.run.id, created.callIds)
        return json(response, 202, created.run)
      }
      if (method === "POST" && url.pathname === "/api/live") {
        if (!live) return json(response, 503, { error: "JEV_API_KEY is not configured on the API server" })
        const decoded = Schema.decodeUnknownEither(CreateLive)(await readJson(request))
        if (Either.isLeft(decoded)) return json(response, 400, { error: "Invalid live session request" })
        const session = await live.create(
          decoded.right.callId,
          decoded.right.intervalMs,
          decoded.right.scoreEveryTurns,
        )
        return session
          ? json(response, 201, session)
          : json(response, 404, { error: "Call not found or no criteria enabled" })
      }
      const liveMatch = url.pathname.match(/^\/api\/live\/([^/]+)$/)
      if (method === "GET" && liveMatch) {
        if (!live) return json(response, 503, { error: "JEV_API_KEY is not configured on the API server" })
        const session = await live.get(decodeURIComponent(liveMatch[1]!))
        return session ? json(response, 200, session) : json(response, 404, { error: "Live session not found" })
      }
      const liveControlMatch = url.pathname.match(/^\/api\/live\/([^/]+)\/control$/)
      if (method === "POST" && liveControlMatch) {
        if (!live) return json(response, 503, { error: "JEV_API_KEY is not configured on the API server" })
        const decoded = Schema.decodeUnknownEither(ControlLive)(await readJson(request))
        if (Either.isLeft(decoded)) return json(response, 400, { error: "Invalid live control action" })
        const session = await live.control(
          decodeURIComponent(liveControlMatch[1]!),
          decoded.right.action,
          { intervalMs: decoded.right.intervalMs, scoreEveryTurns: decoded.right.scoreEveryTurns },
        )
        return session ? json(response, 200, session) : json(response, 404, { error: "Live session not found" })
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
      if (method === "GET" && runMatch) {
        const run = await runtime.runPromise(getRun(decodeURIComponent(runMatch[1]!)))
        return run ? json(response, 200, run) : json(response, 404, { error: "Run not found" })
      }
      return json(response, 404, { error: "Route not found" })
    } catch (cause) {
      const message = cause instanceof SyntaxError ? "Malformed JSON body" : "Internal server error"
      if (!(cause instanceof SyntaxError)) console.error("API request failed", cause)
      return json(response, cause instanceof SyntaxError ? 400 : 500, { error: message })
    }
  }
}
