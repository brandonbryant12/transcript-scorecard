import { Effect } from "effect"
import { classifyWithTypeSafe } from "./classifier"
import {
  finishRun,
  getCall,
  getRunCriteria,
  markCallFailed,
  markCallProcessing,
  markRunStarted,
  saveEvaluation,
} from "./repository"

const publicError = (cause: unknown): string => {
  if (!(cause instanceof Error)) return "Classification failed"
  if (/401|403|api key|unauthorized/i.test(cause.message)) return "TypeSafe rejected the API credentials"
  if (/429|rate/i.test(cause.message)) return "TypeSafe rate limit reached; try again shortly"
  return cause.message.slice(0, 240)
}

export const processRun = (runId: string, callIds: ReadonlyArray<string>, apiKey: string) =>
  Effect.gen(function* () {
    yield* markRunStarted(runId)
    const criteria = yield* getRunCriteria(runId)
    yield* Effect.forEach(
      callIds,
      (callId) =>
        Effect.gen(function* () {
          yield* markCallProcessing(runId, callId)
          const call = yield* getCall(callId)
          if (!call) return yield* markCallFailed(runId, callId, "Call no longer exists")
          const evaluation = yield* classifyWithTypeSafe(call, criteria, runId, apiKey)
          yield* saveEvaluation(evaluation)
        }).pipe(
          Effect.catchAll((cause) => markCallFailed(runId, callId, publicError(cause))),
        ),
      { concurrency: 2 },
    )
    yield* finishRun(runId)
  })
