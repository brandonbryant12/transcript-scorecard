import { Effect } from "effect"
import { classifyTranscript } from "./classifier"
import {
  finishRun,
  getCall,
  getRunCriteria,
  getRun,
  markCallFailed,
  markCallProcessing,
  markRunStarted,
  saveEvaluation,
} from "./repository"

import { requireProviderKey, publicProviderError, type ProviderCredentials } from "./providers"

export const processRun = (runId: string, callIds: ReadonlyArray<string>, credentials: ProviderCredentials) =>
  Effect.gen(function* () {
    yield* markRunStarted(runId)
    const criteria = yield* getRunCriteria(runId)
    const run = yield* getRun(runId)
    if (!run) return
    const provider = run.provider
    yield* Effect.forEach(
      callIds,
      (callId) =>
        Effect.gen(function* () {
          yield* markCallProcessing(runId, callId)
          const call = yield* getCall(callId)
          if (!call) return yield* markCallFailed(runId, callId, "Call no longer exists")
          const evaluation = yield* classifyTranscript(call, criteria, runId, requireProviderKey(credentials, provider), undefined, undefined, undefined, provider)
          yield* saveEvaluation(evaluation)
        }).pipe(
          Effect.catchAll((cause) => markCallFailed(runId, callId, publicProviderError(cause, provider))),
        ),
      { concurrency: 2 },
    )
    yield* finishRun(runId)
  })
