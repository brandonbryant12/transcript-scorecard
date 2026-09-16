import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import type { CallDetail, Criterion } from "@scorecard/domain"
import { classifyWithTypeSafe } from "./classifier"

describe("TypeSafe classifier adapter", () => {
  it("sends structured state with score and evidence questions", async () => {
    let requestBody: Record<string, unknown> | undefined
    const fakeFetch: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({
        model: "jev-test",
        answers: {
          score__empathy: {
            type: "score", score: 3.5, confidence: 0.8,
            probabilities: { "0": 0, "1": 0.05, "2": 0.1, "3": 0.25, "4": 0.6 },
            legend: {},
          },
          evidence__empathy: {
            type: "choice", choice: "turn-2", confidence: 0.9,
            probabilities: { none: 0.1, "turn-1": 0.1, "turn-2": 0.8 },
          },
        },
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } })
    }
    const call: CallDetail = {
      id: "call-test", customerName: "Fictional Customer", agentName: "Demo Agent",
      subject: "Test", startedAt: "2026-01-01T00:00:00Z", durationSeconds: 30,
      status: "pending", overallScore: null, error: null, evaluation: null,
      transcript: [
        { id: "turn-1", speaker: "customer", text: "This is frustrating.", startSeconds: 0 },
        { id: "turn-2", speaker: "employee", text: "I understand why, and I can fix it.", startSeconds: 4 },
      ],
    }
    const criterion: Criterion = {
      id: "empathy", name: "Empathy", description: "Acknowledges emotion", weight: 1,
      levels: ["None", "Weak", "Okay", "Good", "Excellent"], enabled: true,
      updatedAt: "2026-01-01T00:00:00Z",
    }

    const result = await Effect.runPromise(
      classifyWithTypeSafe(call, [criterion], "run-test", "secret-never-serialized", fakeFetch),
    )
    expect(result.overallScore).toBe(87.5)
    expect(result.criteria[0]!.evidence?.turnId).toBe("turn-2")
    expect(requestBody?.model).toBe("jev-latest")
    expect(Object.keys(requestBody?.questions as object)).toEqual([
      "score__empathy",
      "evidence__empathy",
    ])
    expect(JSON.stringify(requestBody)).not.toContain("secret-never-serialized")
  })
})
