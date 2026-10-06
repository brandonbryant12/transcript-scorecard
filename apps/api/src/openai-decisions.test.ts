import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import type { CallDetail, Criterion } from "@scorecard/domain"
import { classifyTranscript } from "./classifier"
import { requestOpenAIDecision } from "./openai-decisions"

const call: CallDetail = {
  id: "call-test", provider: null, customerName: "Customer", agentName: "Agent", subject: "Support",
  startedAt: "2026-01-01T00:00:00Z", durationSeconds: 20, status: "pending", overallScore: null,
  error: null, evaluation: null, latencyMs: null, inputTokens: null, outputTokens: null,
  estimatedCostUsd: null, model: null, evaluatedAt: null,
  transcript: [{ id: "turn-1", speaker: "employee", text: "I understand your frustration. Let me restate the issue.", startSeconds: 0 }],
}
const criterion: Criterion = {
  id: "empathy", name: "Empathy", description: "Acknowledges emotion", weight: 100,
  levels: ["None", "Weak", "Okay", "Good", "Excellent"], enabled: true, updatedAt: call.startedAt,
}
const payload = () => ({
  model: "gpt-6-luna", usage: { input_tokens: 100, output_tokens: 0 },
  answers: [
    { name: "score__empathy", type: "score", score: 3.5, confidence: .8,
      probabilities: criterion.levels.map((label, value) => ({ label, value, probability: value === 3 || value === 4 ? .5 : 0 })) },
    { name: "evidence__empathy", type: "choice", choice: "turn-1", confidence: .9,
      probabilities: [{ value: "none", probability: .1 }, { value: "turn-1", probability: .9 }] },
    { name: "signal__restated", type: "predicate", probability: .85 },
    { name: "signal__emotion", type: "choice", choice: "neutral", confidence: .7,
      probabilities: ["frustrated", "anxious", "skeptical", "cooperative", "reassured", "neutral"].map((value) => ({ value, probability: value === "neutral" ? 1 : 0 })) },
  ],
})

const respond = (value: unknown): typeof fetch => async () => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } })

describe("OpenAI Decisions classifier", () => {
  it("defaults to Decisions and normalizes score, evidence, signals and timing", async () => {
    let body: Record<string, unknown> = {}
    let completed = -1
    const transport: typeof fetch = async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/decisions")
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer server-only-key")
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      body = JSON.parse(String(init?.body))
      return respond(payload())(url, init)
    }
    const result = await Effect.runPromise(classifyTranscript(call, [criterion], "test-run", "server-only-key", transport,
      { revealedTurnCount: 1, totalTurns: 3 }, { onComplete: (ms) => { completed = ms } }))
    expect(body.model).toBe("gpt-6-luna")
    expect(JSON.stringify(body)).not.toContain("server-only-key")
    const input = JSON.parse(String(body.input))
    expect(input.call.transcript).toHaveLength(1)
    expect(input.evaluation_context.assessment_stage).toBe("provisional")
    expect(body.questions).toMatchObject([
      { name: "score__empathy", type: "score", levels: criterion.levels.map((label) => ({ label })) },
      { name: "evidence__empathy", type: "choice" },
      { name: "signal__restated", type: "predicate" },
      { name: "signal__emotion", type: "choice" },
    ])
    expect(result).toMatchObject({ provider: "openai", model: "gpt-6-luna", overallScore: 87.5,
      inputTokens: 100, outputTokens: 0, providerLatencyMs: completed,
      signals: { restatedProblem: .85, emotion: { label: "neutral" } } })
    expect(result.criteria[0]).toMatchObject({ rawScore: 3.5, normalizedScore: 87.5,
      evidence: { turnId: "turn-1" }, probabilities: { "3": .5, "4": .5 } })
  })

  it.each(["refusal", "missing", "wrong-name", "wrong-type", "unknown-evidence", "out-of-range", "invalid-confidence"])("fails explicitly for %s without switching providers", async (failure) => {
    const value: { model: string; usage: object; answers: Array<Record<string, unknown>> } = payload()
    if (failure === "refusal") value.answers[0] = { name: "score__empathy", type: "refusal" }
    if (failure === "missing") value.answers.pop()
    if (failure === "wrong-name") value.answers[0]!.name = "score__other"
    if (failure === "wrong-type") value.answers[0] = { name: "score__empathy", type: "predicate", probability: .5 }
    if (failure === "unknown-evidence") value.answers[1]!.choice = "turn-99"
    if (failure === "out-of-range") value.answers[0]!.score = 9
    if (failure === "invalid-confidence") value.answers[0]!.confidence = 2
    await expect(Effect.runPromise(classifyTranscript(call, [criterion], "test-run", "key", respond(value)))).rejects.toThrow()
  })

  it.each([401, 429, 500])("redacts HTTP %s errors and records failed request timing", async (status) => {
    let completed = -1
    const transport: typeof fetch = async () => new Response("sensitive-key echoed here", { status })
    await expect(Effect.runPromise(classifyTranscript(call, [criterion], "test-run", "sensitive-key", transport,
      undefined, { onComplete: (ms) => { completed = ms } }))).rejects.toThrow(/OpenAI Decisions/)
    expect(completed).toBeGreaterThanOrEqual(0)
    await expect(requestOpenAIDecision({}, { test: { type: "noul", instructions: "test", criteria: { true: "Yes", false: "No" } } }, "sensitive-key", transport, new AbortController().signal)).rejects.not.toThrow("sensitive-key")
  })
})
