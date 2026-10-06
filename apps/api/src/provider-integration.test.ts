import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { ManagedRuntime } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createLiveSession, createRun, getCall, getLiveSession, getRun, initializeDatabase, revealLiveTurn, setLiveStatus } from "./repository"
import { processRun } from "./runner"
import { makeLiveCoordinator } from "./live"
import { providerFixture } from "./provider-fixtures"

const credentials = { openai: "openai-server-key", jev: "jev-server-key" }

describe("provider worker integration", () => {
  let directory: string
  // Infer the SQLite environment from the layer rather than widen the coordinator.
  const makeRuntime = (filename: string) => ManagedRuntime.make(SqliteClient.layer({ filename }))
  let sqlite: ReturnType<typeof makeRuntime>
  const requestedProviders: string[] = []

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "scorecard-provider-"))
    sqlite = makeRuntime(join(directory, "test.sqlite"))
    await sqlite.runPromise(initializeDatabase)
    requestedProviders.length = 0
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const openai = String(url) === "https://api.openai.com/v1/decisions"
      if (!openai && !String(url).startsWith("https://api.typesafe.ai/")) throw new Error("Unexpected test network destination")
      const provider = openai ? "openai" : "jev"
      requestedProviders.push(provider)
      expect((init.headers as Record<string, string>).Authorization ?? (init.headers as Record<string, string>).authorization).toBe(`Bearer ${credentials[provider]}`)
      return new Response(JSON.stringify(providerFixture(openai, JSON.parse(String(init.body)))), { headers: { "Content-Type": "application/json" } })
    })
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await sqlite.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  it.each(["openai", "jev"] as const)("routes %s batches and persists results", async (provider) => {
    const created = await sqlite.runPromise(createRun({ callIds: ["call-1001"], provider }))
    if ("error" in created) throw new Error(created.error)
    await sqlite.runPromise(processRun(created.run.id, created.callIds, credentials))
    expect(await sqlite.runPromise(getRun(created.run.id))).toMatchObject({ provider, status: "completed", completed: 1, failed: 0 })
    expect(await sqlite.runPromise(getCall("call-1001"))).toMatchObject({ provider, evaluation: { provider }, overallScore: provider === "openai" ? 100 : 75 })
    expect(requestedProviders).toEqual([provider])
  })

  it.each(["openai", "jev"] as const)("routes %s final replays and persists separate snapshots", async (provider) => {
    const created = await sqlite.runPromise(createLiveSession("call-1001", undefined, undefined, provider))
    if (!created) throw new Error("No session")
    await sqlite.runPromise(setLiveStatus(created.id, "playing"))
    for (let index = 0; index < created.totalTurns; index++) await sqlite.runPromise(revealLiveTurn(created.id))
    const coordinator = makeLiveCoordinator(sqlite, credentials)
    try {
      await coordinator.control(created.id, "start")
      for (let attempt = 0; attempt < 50; attempt++) {
        const session = await sqlite.runPromise(getLiveSession(created.id))
        if (session?.status === "completed") break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(await sqlite.runPromise(getLiveSession(created.id))).toMatchObject({ provider, status: "completed",
        scoredTurnCount: created.totalTurns, totalInputTokens: 1000, totalOutputTokens: 0,
        snapshots: [{ turnCount: created.totalTurns, overallScore: provider === "openai" ? 100 : 75 }] })
      // Snapshot completion is followed by persistence of the final call evaluation.
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await sqlite.runPromise(getCall("call-1001")))?.evaluation) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      expect(await sqlite.runPromise(getCall("call-1001"))).toMatchObject({ evaluation: { provider } })
      expect(requestedProviders).toEqual([provider])
    } finally { coordinator.dispose() }
  })
})
