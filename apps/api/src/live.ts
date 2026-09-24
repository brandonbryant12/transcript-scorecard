import type { SqlClient } from "@effect/sql"
import type { LiveSessionDetail } from "@scorecard/domain"
import { clampRevealIntervalMs, estimateSystemOneCostUsd } from "@scorecard/domain"
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
  setLivePacing,
  setLiveStatus,
} from "./repository"

interface LiveRuntime {
  readonly runPromise: <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>
}

// Turns reveal faster than they are scored: a request goes out once enough turns have
// piled up unscored, and always for the last turn so the final evaluation covers the
// whole call regardless of where the batch boundary fell.
const readyToScore = (session: LiveSessionDetail): boolean => {
  const pending = session.revealedTurnCount - session.scoredTurnCount
  if (pending <= 0) return false
  return pending >= session.scoreEveryTurns || session.revealedTurnCount >= session.totalTurns
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
    let providerLatencyMs: number | null = null
    try {
      const session = await runtime.runPromise(getLiveSession(id))
      if (!session || session.status === "failed" || session.status === "completed") {
        clearTimer(id)
        return
      }
      if (!readyToScore(session)) return
      if (session.status !== "playing") return

      generation = session.generation
      const turnCount = session.revealedTurnCount
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
          {
            onStart: (startedAt) => runtime.runPromise(beginLiveScoring(id, generation!, startedAt)),
            onComplete: (latencyMs) => {
              providerLatencyMs = latencyMs
            },
          },
        ),
      )
      const applied = await runtime.runPromise(
        saveLiveSnapshot(
          id,
          generation,
          turnCount,
          { overallScore: evaluation.overallScore, criteria: evaluation.criteria, signals: evaluation.signals },
          evaluation.providerLatencyMs,
          {
            model: evaluation.model,
            inputTokens: evaluation.inputTokens,
            outputTokens: evaluation.outputTokens,
            estimatedCostUsd: estimateSystemOneCostUsd(evaluation.inputTokens, evaluation.outputTokens),
          },
        ),
      )
      if (applied && turnCount === session.totalTurns) {
        // The completed replay is also the call's latest full evaluation, so it appears
        // in the call library and dashboard while incremental snapshots remain live-only.
        await runtime.runPromise(saveEvaluation(evaluation))
      }
    } catch (cause) {
      if (generation !== undefined) {
        await runtime.runPromise(failLiveScoring(id, generation, publicError(cause), providerLatencyMs))
      }
    } finally {
      inFlight.delete(id)
      if (disposed) return
      const latest = await runtime.runPromise(getLiveSession(id))
      if (!latest || latest.status === "completed" || latest.status === "failed") clearTimer(id)
      else if (latest.status === "playing" && readyToScore(latest)) {
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
    create: (callId: string, intervalMs?: number, scoreEveryTurns?: number) =>
      runtime.runPromise(createLiveSession(callId, intervalMs, scoreEveryTurns)),
    get: (id: string) => runtime.runPromise(getLiveSession(id)),
    control: async (
      id: string,
      action: "start" | "pause" | "reset" | "pace",
      pacing: { readonly intervalMs?: number | undefined; readonly scoreEveryTurns?: number | undefined } = {},
    ) => {
      if (pacing.intervalMs !== undefined || pacing.scoreEveryTurns !== undefined) {
        await runtime.runPromise(setLivePacing(id, pacing))
      }
      if (action === "reset") {
        clearTimer(id)
        return runtime.runPromise(resetLiveSession(id))
      }
      if (action === "pause") {
        clearTimer(id)
        return runtime.runPromise(setLiveStatus(id, "paused"))
      }
      if (action === "pace") {
        const paced = await runtime.runPromise(getLiveSession(id))
        // Re-arm the ticker at the new spacing only while the replay is actually running,
        // and re-check the gate in case a smaller batch size is now already satisfied.
        if (paced?.status === "playing") {
          clearTimer(id)
          timers.set(id, setInterval(() => safely(tick(id)), clampRevealIntervalMs(paced.revealIntervalMs)))
          if (readyToScore(paced)) safely(kick(id))
        }
        return paced
      }
      const session = await runtime.runPromise(setLiveStatus(id, "playing"))
      if (!session) return null
      clearTimer(id)
      safely(tick(id))
      timers.set(id, setInterval(() => safely(tick(id)), clampRevealIntervalMs(session.revealIntervalMs)))
      return session
    },
    dispose: () => {
      disposed = true
      for (const id of timers.keys()) clearTimer(id)
    },
  }
}
