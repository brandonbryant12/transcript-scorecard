import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { SqlClient } from "@effect/sql"
import type { LiveEvaluation } from "@scorecard/domain"
import { Effect, ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  beginLiveScoring,
  createLiveSession,
  getLiveSession,
  initializeDatabase,
  resetLiveSession,
  revealLiveTurn,
  saveLiveSnapshot,
  setLiveStatus,
} from "./repository"

const makeRuntime = (filename: string) => ManagedRuntime.make(SqliteClient.layer({ filename }))

const evaluation = (overallScore: number): LiveEvaluation => ({
  overallScore,
  signals: null,
  criteria: [{
    criterionId: "empathy",
    criterionName: "Empathy & active listening",
    criterionDescription: "Recognizes the customer’s emotion.",
    weight: 25,
    levels: ["Dismissive", "Minimal", "Adequate", "Strong", "Exceptional"],
    rawScore: overallScore / 25,
    normalizedScore: overallScore,
    confidence: 0.8,
    probabilities: { "0": 0.02, "1": 0.03, "2": 0.1, "3": 0.25, "4": 0.6 },
    evidence: null,
  }],
})

describe("live session persistence", () => {
  let directory: string
  let filename: string
  let runtime: ReturnType<typeof makeRuntime>

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "scorecard-live-"))
    filename = join(directory, "test.sqlite")
    runtime = makeRuntime(filename)
    await runtime.runPromise(initializeDatabase)
  })

  afterEach(async () => {
    await runtime.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  it("reveals only the transcript prefix and does not advance while paused", async () => {
    const created = await runtime.runPromise(createLiveSession("call-1001"))
    expect(created).not.toBeNull()
    const id = created!.id

    await runtime.runPromise(setLiveStatus(id, "playing"))
    const first = await runtime.runPromise(revealLiveTurn(id))
    expect(first?.revealedTurnCount).toBe(1)
    expect(first?.transcript).toHaveLength(1)
    expect(first?.transcript[0]?.id).toBe("turn-1")
    expect(first?.transcript.some(({ id: turnId }) => turnId === "turn-2")).toBe(false)

    await runtime.runPromise(setLiveStatus(id, "paused"))
    const paused = await runtime.runPromise(revealLiveTurn(id))
    expect(paused?.status).toBe("paused")
    expect(paused?.revealedTurnCount).toBe(1)
    expect(paused?.transcript).toHaveLength(1)
  })

  it("ignores an in-flight scoring result after reset changes the generation", async () => {
    const created = await runtime.runPromise(createLiveSession("call-1002"))
    const id = created!.id
    const staleGeneration = created!.generation

    await runtime.runPromise(setLiveStatus(id, "playing"))
    await runtime.runPromise(revealLiveTurn(id))
    await runtime.runPromise(beginLiveScoring(id, staleGeneration))
    const reset = await runtime.runPromise(resetLiveSession(id))
    expect(reset?.generation).toBe(staleGeneration + 1)

    const saved = await runtime.runPromise(
      saveLiveSnapshot(id, staleGeneration, 1, evaluation(92), 40),
    )
    expect(saved).toBe(false)

    const current = await runtime.runPromise(getLiveSession(id))
    expect(current).toMatchObject({
      status: "ready",
      generation: staleGeneration + 1,
      revealedTurnCount: 0,
      scoredTurnCount: 0,
      isProcessing: false,
      evaluation: null,
      snapshots: [],
    })
  })

  it("anchors each provider request to a server timestamp and preserves its measured duration", async () => {
    const created = await runtime.runPromise(createLiveSession("call-1001"))
    const id = created!.id
    const generation = created!.generation
    const startedAt = "2026-09-16T20:15:30.000Z"

    await runtime.runPromise(beginLiveScoring(id, generation, startedAt))
    const running = await runtime.runPromise(getLiveSession(id))
    expect(running).toMatchObject({
      isProcessing: true,
      requestStartedAt: startedAt,
      requestIndex: 1,
    })

    await runtime.runPromise(saveLiveSnapshot(id, generation, 1, evaluation(72), 187))
    const settled = await runtime.runPromise(getLiveSession(id))
    expect(settled).toMatchObject({
      isProcessing: false,
      requestStartedAt: null,
      requestIndex: 1,
      processingLatencyMs: 187,
    })

    await runtime.runPromise(resetLiveSession(id))
    const reset = await runtime.runPromise(getLiveSession(id))
    expect(reset).toMatchObject({ requestStartedAt: null, requestIndex: 0 })
  })

  it("adds provider timing columns to an existing live session database", async () => {
    const legacyFilename = join(directory, "legacy.sqlite")
    let legacyRuntime = makeRuntime(legacyFilename)
    await legacyRuntime.runPromise(Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe(`CREATE TABLE live_sessions (
        id TEXT PRIMARY KEY, call_id TEXT NOT NULL, status TEXT NOT NULL, generation INTEGER NOT NULL,
        criteria_json TEXT NOT NULL, revealed_turn_count INTEGER NOT NULL DEFAULT 0,
        scored_turn_count INTEGER NOT NULL DEFAULT 0, is_processing INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER NOT NULL DEFAULT 0, processing_latency_ms INTEGER,
        evaluation_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT
      )`)
    }))
    await legacyRuntime.dispose()

    legacyRuntime = makeRuntime(legacyFilename)
    await legacyRuntime.runPromise(initializeDatabase)
    const created = await legacyRuntime.runPromise(createLiveSession("call-1001"))
    expect(created).toMatchObject({ requestStartedAt: null, requestIndex: 0 })
    await legacyRuntime.dispose()
  })

  it("recovers an active session as paused after API process initialization", async () => {
    const created = await runtime.runPromise(createLiveSession("call-1006"))
    const id = created!.id

    await runtime.runPromise(setLiveStatus(id, "playing"))
    await runtime.runPromise(revealLiveTurn(id))
    await runtime.runPromise(beginLiveScoring(id, created!.generation))
    const active = await runtime.runPromise(getLiveSession(id))
    expect(active).toMatchObject({ status: "playing", isProcessing: true, revealedTurnCount: 1 })

    await runtime.runPromise(initializeDatabase)
    const recovered = await runtime.runPromise(getLiveSession(id))
    expect(recovered).toMatchObject({
      status: "paused",
      isProcessing: false,
      revealedTurnCount: 1,
      generation: created!.generation,
    })
  })

  it("orders snapshot history and persists the final completed evaluation", async () => {
    const created = await runtime.runPromise(createLiveSession("call-1003"))
    const id = created!.id
    const generation = created!.generation

    await runtime.runPromise(setLiveStatus(id, "playing"))
    await runtime.runPromise(revealLiveTurn(id))
    expect(await runtime.runPromise(saveLiveSnapshot(id, generation, 1, evaluation(45), 31))).toBe(true)

    for (let index = 1; index < created!.totalTurns; index += 1) {
      await runtime.runPromise(revealLiveTurn(id))
    }
    expect(
      await runtime.runPromise(
        saveLiveSnapshot(id, generation, created!.totalTurns, evaluation(88), 29),
      ),
    ).toBe(true)

    const completed = await runtime.runPromise(getLiveSession(id))
    expect(completed?.status).toBe("completed")
    expect(completed?.evaluation?.overallScore).toBe(88)
    expect(completed?.snapshots.map(({ sequence, turnCount, overallScore }) => ({
      sequence,
      turnCount,
      overallScore,
    }))).toEqual([
      { sequence: 1, turnCount: 1, overallScore: 45 },
      { sequence: 2, turnCount: created!.totalTurns, overallScore: 88 },
    ])

    await runtime.dispose()
    runtime = makeRuntime(filename)
    const reopened = await runtime.runPromise(getLiveSession(id))
    expect(reopened?.status).toBe("completed")
    expect(reopened?.evaluation?.overallScore).toBe(88)
    expect(reopened?.snapshots).toHaveLength(2)
  })
})
