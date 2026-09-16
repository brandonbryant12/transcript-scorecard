import type { SqlClient } from "@effect/sql"
import { Effect } from "effect"
import { classifyWithTypeSafe } from "./classifier"
import {
  beginLiveScoring,
  createLiveSession,
  failLiveScoring,
  getCall,
  getLiveCriteria,
  getLiveSession,
  resetLiveSession,
  revealLiveTurn,
  saveEvaluation,
  saveLiveSnapshot,
  setLiveStatus,
} from "./repository"

interface LiveRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>
}

const publicError = (cause: unknown): string =>
  cause instanceof Error ? cause.message.slice(0, 240) : "Live scoring failed"

export const makeLiveCoordinator = (runtime: LiveRuntime, apiKey: string) => {
  const timers = new Map<string, NodeJS.Timeout>()
  const inFlight = new Set<string>()
  let disposed = false

  const safely = (work: Promise<void>): void => {
    void work.catch(() => {})
  }

  const clearTimer = (id: string): void => {
    const timer = timers.get(id)
    if (timer) clearInterval(timer)
    timers.delete(id)
  }

  const kick = async (id: string): Promise<void> => {
    if (disposed || inFlight.has(id)) return
    inFlight.add(id)
    let generation: number | undefined
    try {
      const session = await runtime.runPromise(getLiveSession(id))
      if (!session || session.status === "failed" || session.status === "completed") {
        clearTimer(id)
        return
      }
      if (session.revealedTurnCount === 0 || session.revealedTurnCount <= session.scoredTurnCount) return
      if (session.status !== "playing") return

      generation = session.generation
      const turnCount = session.revealedTurnCount
      const started = Date.now()
      await runtime.runPromise(beginLiveScoring(id, generation))
      const [call, criteria] = await Promise.all([
        runtime.runPromise(getCall(session.callId)),
        runtime.runPromise(getLiveCriteria(id)),
      ])
      if (!call || !criteria) throw new Error("Live scoring data is unavailable")
      const evaluation = await Effect.runPromise(
        classifyWithTypeSafe(
          { ...call, transcript: session.transcript },
          criteria,
          `live:${id}:${generation}:${turnCount}`,
          apiKey,
          undefined,
          { revealedTurnCount: turnCount, totalTurns: session.totalTurns },
        ),
      )
      const applied = await runtime.runPromise(
        saveLiveSnapshot(
          id,
          generation,
          turnCount,
          { overallScore: evaluation.overallScore, criteria: evaluation.criteria },
          Date.now() - started,
        ),
      )
      if (applied && turnCount === session.totalTurns) {
        // The completed replay is also the call's latest full evaluation, so it appears
        // in the call library and dashboard while incremental snapshots remain live-only.
        await runtime.runPromise(saveEvaluation(evaluation))
      }
    } catch (cause) {
      if (generation !== undefined) {
        await runtime.runPromise(failLiveScoring(id, generation, publicError(cause)))
      }
    } finally {
      inFlight.delete(id)
      if (disposed) return
      const latest = await runtime.runPromise(getLiveSession(id))
      if (!latest || latest.status === "completed" || latest.status === "failed") clearTimer(id)
      else if (latest.status === "playing" && latest.revealedTurnCount > latest.scoredTurnCount) {
        safely(kick(id))
      }
    }
  }

  const tick = async (id: string): Promise<void> => {
    const session = await runtime.runPromise(revealLiveTurn(id))
    if (!session) return clearTimer(id)
    safely(kick(id))
  }

  return {
    create: (callId: string) => runtime.runPromise(createLiveSession(callId)),
    get: (id: string) => runtime.runPromise(getLiveSession(id)),
    control: async (id: string, action: "start" | "pause" | "reset") => {
      if (action === "reset") {
        clearTimer(id)
        return runtime.runPromise(resetLiveSession(id))
      }
      if (action === "pause") {
        clearTimer(id)
        return runtime.runPromise(setLiveStatus(id, "paused"))
      }
      const session = await runtime.runPromise(setLiveStatus(id, "playing"))
      if (!session) return null
      clearTimer(id)
      safely(tick(id))
      timers.set(id, setInterval(() => safely(tick(id)), 1000))
      return session
    },
    dispose: () => {
      disposed = true
      for (const id of timers.keys()) clearTimer(id)
    },
  }
}
