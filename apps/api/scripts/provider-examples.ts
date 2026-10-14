// Capture real OpenAI Decisions and JEV wire traffic for a short mock call.
// Run: pnpm --filter @scorecard/api provider-examples
// Requires OPENAI_API_KEY and JEV_API_KEY. Every run makes billable requests.
import type { CallDetail, ScoringProvider } from "@scorecard/domain"
import { Effect } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
import { classifyTranscript } from "../src/classifier"
import { seedCriteria } from "../src/seed"

const ROUNDS = Number(process.env.ROUNDS ?? 10)
const OUT = new URL("../../../docs/provider-examples/", import.meta.url)

const call: CallDetail = {
  provider: null,
  id: "call-mock-001",
  customerName: "Sam Rivera",
  agentName: "Priya Patel",
  subject: "Locked out after password reset",
  startedAt: "2026-10-14T15:00:00.000Z",
  durationSeconds: 95,
  status: "pending",
  overallScore: null,
  error: null,
  latencyMs: null,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  model: null,
  evaluatedAt: null,
  evaluation: null,
  transcript: [
    ["employee", "ACME Support, this is Priya. How can I help?", 0],
    ["customer", "I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.", 6],
    ["employee", "That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?", 18],
    ["customer", "sam.rivera@example.com, and the phone ends in 4417.", 31],
    ["employee", "Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.", 40],
    ["customer", "Got the code and I'm in. Thank you!", 72],
  ].map(([speaker, text, startSeconds], index) => ({
    id: `turn-${index + 1}`,
    speaker: speaker as "customer" | "employee",
    text: text as string,
    startSeconds: startSeconds as number,
  })),
}

interface Capture {
  readonly provider: ScoringProvider
  readonly round: number
  readonly url: string
  readonly status: number
  readonly request: unknown
  readonly response: unknown
  readonly httpMs: number
  readonly providerLatencyMs: number
  readonly overallScore: number
  readonly inputTokens: number
}

const keys: Record<ScoringProvider, string | undefined> = {
  openai: process.env.OPENAI_API_KEY,
  jev: process.env.JEV_API_KEY,
}
for (const [provider, key] of Object.entries(keys)) {
  if (!key) throw new Error(`${provider === "openai" ? "OPENAI_API_KEY" : "JEV_API_KEY"} is not set`)
}

const captureOne = async (provider: ScoringProvider, round: number): Promise<Capture> => {
  let wire: Omit<Capture, "provider" | "round" | "providerLatencyMs" | "overallScore" | "inputTokens"> | undefined
  // Record only the URL, bodies and status. Headers carry the bearer token and are never kept.
  const capturingFetch: typeof fetch = async (input, init) => {
    const started = performance.now()
    const response = await fetch(input, init)
    const text = await response.clone().text()
    wire = {
      url: input instanceof Request ? input.url : String(input),
      status: response.status,
      request: JSON.parse(String(init?.body)),
      response: JSON.parse(text),
      httpMs: Math.round(performance.now() - started),
    }
    return response
  }
  const evaluation = await Effect.runPromise(
    classifyTranscript(call, seedCriteria, `examples-${round}`, keys[provider]!, capturingFetch, undefined, undefined, provider),
  )
  if (!wire) throw new Error(`${provider} made no HTTP request`)
  return {
    provider, round, ...wire,
    providerLatencyMs: evaluation.providerLatencyMs,
    overallScore: evaluation.overallScore,
    inputTokens: evaluation.inputTokens,
  }
}

const summarize = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  return {
    n: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1]! + sorted[mid]!) / 2,
    mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length * 10) / 10,
    max: sorted.at(-1),
  }
}

// Pretty-print JSON, keeping any value that fits within 100 columns on one line.
const compactJson = (value: unknown, indent = "", used = 0): string => {
  const inline = JSON.stringify(value, null, 1).replace(/\n\s*/g, " ")
  if (value === null || typeof value !== "object" || indent.length + used + inline.length <= 100) return inline
  const next = indent + "  "
  const lines = Array.isArray(value)
    ? value.map((item) => next + compactJson(item, next))
    : Object.entries(value).map(([key, item]) => `${next}${JSON.stringify(key)}: ${compactJson(item, next, key.length + 4)}`)
  return `${Array.isArray(value) ? "[" : "{"}\n${lines.join(",\n")}\n${indent}${Array.isArray(value) ? "]" : "}"}`
}

// Interleave providers so network conditions affect both equally. Requests run one at a time.
const captures: Capture[] = []
for (let round = 1; round <= ROUNDS; round++) {
  for (const provider of (round % 2 ? ["openai", "jev"] : ["jev", "openai"]) as ScoringProvider[]) {
    const capture = await captureOne(provider, round)
    captures.push(capture)
    console.log(`round ${round} ${provider}: ${capture.httpMs} ms HTTP, ${capture.providerLatencyMs} ms provider, score ${capture.overallScore}`)
  }
}

mkdirSync(OUT, { recursive: true })
const summary = Object.fromEntries((["openai", "jev"] as const).map((provider) => {
  const runs = captures.filter((capture) => capture.provider === provider)
  return [provider, {
    model: (runs[0]!.response as { model: string }).model,
    inputTokens: summarize(runs.map((run) => run.inputTokens)),
    overallScore: summarize(runs.map((run) => run.overallScore)),
    httpMs: summarize(runs.map((run) => run.httpMs)),
    providerLatencyMs: summarize(runs.map((run) => run.providerLatencyMs)),
    httpMsByRound: runs.map((run) => run.httpMs),
  }]
}))
writeFileSync(new URL("summary.json", OUT), compactJson({
  capturedAt: new Date().toISOString(),
  node: process.version,
  rounds: ROUNDS,
  call: { id: call.id, subject: call.subject, turns: call.transcript.length },
  summary,
}) + "\n")
for (const provider of ["openai", "jev"] as const) {
  const first = captures.find((capture) => capture.provider === provider)!
  writeFileSync(new URL(`${provider}-request.json`, OUT), compactJson(first.request) + "\n")
  writeFileSync(new URL(`${provider}-response.json`, OUT), compactJson(first.response) + "\n")
}
console.log(compactJson(summary))
