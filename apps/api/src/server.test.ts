import { createServer, type Server } from "node:http"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { ManagedRuntime } from "effect"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { initializeDatabase } from "./repository"
import { makeRequestHandler } from "./server"

describe("scorecard API", () => {
  const directory = mkdtempSync(join(tmpdir(), "scorecard-api-"))
  const runtime = ManagedRuntime.make(SqliteClient.layer({ filename: join(directory, "test.sqlite") }))
  let server: Server
  let baseUrl: string
  const dispatched: string[] = []

  beforeAll(async () => {
    await runtime.runPromise(initializeDatabase)
    server = createServer(makeRequestHandler(runtime, { openai: "openai-test-key", jev: "jev-test-key" }, (_runId, _ids, provider) => { dispatched.push(provider) }))
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Test server did not bind")
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await runtime.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  it("serves seeded calls and call detail", async () => {
    const callsResponse = await fetch(`${baseUrl}/api/calls`)
    const calls = (await callsResponse.json()) as Array<{ id: string }>
    expect(callsResponse.status).toBe(200)
    expect(calls.length).toBeGreaterThanOrEqual(8)

    const detailResponse = await fetch(`${baseUrl}/api/calls/${calls[0]!.id}`)
    const detail = (await detailResponse.json()) as { transcript: unknown[]; evaluation: unknown }
    expect(detail.transcript.length).toBeGreaterThan(5)
    expect(detail.evaluation).toBeNull()
  })

  it("validates criteria updates", async () => {
    const response = await fetch(`${baseUrl}/api/criteria/empathy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ levels: ["only one"] }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid criterion update" })
  })

  it("rejects unknown calls before persisting a run", async () => {
    const response = await fetch(`${baseUrl}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callIds: ["does-not-exist"] }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Unknown call IDs: does-not-exist" })
  })

  it("creates a live session without exposing future transcript turns", async () => {
    const response = await fetch(`${baseUrl}/api/live`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callId: "call-1001" }),
    })
    expect(response.status).toBe(201)
    const session = (await response.json()) as {
      status: string
      revealedTurnCount: number
      totalTurns: number
      transcript: unknown[]
    }
    expect(session.status).toBe("ready")
    expect(session.revealedTurnCount).toBe(0)
    expect(session.totalTurns).toBeGreaterThanOrEqual(20)
    expect(session.transcript).toEqual([])
  })
  it("defaults new live sessions and runs to OpenAI and accepts explicit JEV", async () => {
    for (const provider of [undefined, "jev"]) {
      const expected = provider ?? "openai"
      const live = await fetch(`${baseUrl}/api/live`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: "call-1001", provider }),
      })
      expect(live.status).toBe(201)
      expect(await live.json()).toMatchObject({ provider: expected })
      const run = await fetch(`${baseUrl}/api/runs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ callIds: ["call-1001"], provider }),
      })
      expect(run.status).toBe(202)
      const created = await run.json() as { id: string }
      expect(created).toMatchObject({ provider: expected })
      expect(await (await fetch(`${baseUrl}/api/runs/${created.id}`)).json()).toMatchObject({ provider: expected })
      expect(dispatched.at(-1)).toBe(expected)
    }
  })

  it("rejects unknown providers", async () => {
    for (const route of ["live", "runs"]) {
      const response = await fetch(`${baseUrl}/api/${route}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ callId: "call-1001", provider: "invalid" }),
      })
      expect(response.status).toBe(400)
    }
  })

  it("requires only the selected provider key and still serves saved sessions", async () => {
    const localServer = createServer(makeRequestHandler(runtime, { jev: "test-key" }, () => {}))
    await new Promise<void>((resolve) => localServer.listen(0, "127.0.0.1", resolve))
    const address = localServer.address()
    if (!address || typeof address === "string") throw new Error("Server did not bind")
    const url = `http://127.0.0.1:${address.port}`
    try {
      const missing = await fetch(`${url}/api/live`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId: "call-1001" }),
      })
      expect(missing.status).toBe(503)
      expect(await missing.json()).toEqual({ error: "OPENAI_API_KEY is not configured on the API server" })
      const supported = await fetch(`${url}/api/live`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ callId: "call-1001", provider: "jev" }),
      })
      expect(supported.status).toBe(201)
      const created = await supported.json() as { id: string }
      expect((await fetch(`${url}/api/live/${created.id}`)).status).toBe(200)
      expect(await (await fetch(`${url}/api/health`)).json()).toMatchObject({ defaultProvider: "openai", providers: { openai: false, jev: true } })
    } finally {
      await new Promise<void>((resolve) => localServer.close(() => resolve()))
    }
  })

})
