import { choice, score, TypeSafeClient, type Question, type Questions } from "@typesafe-ai/sdk"
import { computeWeightedScore, type CallDetail, type Criterion, type Evaluation } from "@scorecard/domain"
import { Effect, Schema } from "effect"

export interface ProviderTimingHooks {
  readonly onStart?: (startedAt: string) => void | Promise<void>
  readonly onComplete?: (latencyMs: number) => void | Promise<void>
}

const WireAnswer = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Number,
    confidence: Schema.Number,
    probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
    legend: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    confidence: Schema.Number,
    probabilities: Schema.Record({ key: Schema.String, value: Schema.Number }),
  }),
)
const WireResult = Schema.Struct({
  model: Schema.String,
  usage: Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number }),
  answers: Schema.Record({ key: Schema.String, value: WireAnswer }),
})

export const classifyWithTypeSafe = (
  call: CallDetail,
  criteria: ReadonlyArray<Criterion>,
  runId: string,
  apiKey: string,
  fetchImplementation?: typeof fetch,
  liveContext?: { readonly revealedTurnCount: number; readonly totalTurns: number },
  providerTiming?: ProviderTimingHooks,
) =>
  Effect.tryPromise({
    try: async () => {
      const enabled = criteria.filter((criterion) => criterion.enabled)
      if (enabled.length === 0) throw new Error("At least one scorecard criterion must be enabled")

      const evidenceOptions = Object.fromEntries([
        ["none", "No transcript turn provides direct evidence for the judgment."],
        ...call.transcript.map((turn) => [
          turn.id,
          `${turn.speaker === "employee" ? "Employee" : "Customer"}: ${turn.text}`,
        ]),
      ])
      const questions: Record<string, Question> = {}
      for (const criterion of enabled) {
        questions[`score__${criterion.id}`] = score(
          {
            task: `Evaluate the employee on ${criterion.name}.`,
            definition: criterion.description,
            guidance: "Judge only behavior supported by this call. Use the full ordered rubric.",
          },
          criterion.levels as [string, string, ...string[]],
        )
        questions[`evidence__${criterion.id}`] = choice(
          {
            task: `Which single transcript turn contains the most relevant employee behavior for assessing ${criterion.name}?`,
            definition: criterion.description,
            rubric: [...criterion.levels],
            guidance: "Choose none only when no turn contains relevant employee behavior.",
          },
          evidenceOptions,
        )
      }

      const client = new TypeSafeClient({
        apiKey,
        defaultModel: "jev-latest",
        logLevel: "warn",
        ...(fetchImplementation ? { fetch: fetchImplementation } : {}),
      })
      const requestStartedAt = new Date().toISOString()
      await providerTiming?.onStart?.(requestStartedAt)
      const providerStarted = performance.now()
      let rawResponse: unknown
      let providerLatencyMs = 0
      try {
        rawResponse = await client.systemOne({
          model: "jev-latest",
          state: {
            call: {
              subject: call.subject,
              customer_name: call.customerName,
              employee_name: call.agentName,
              transcript: call.transcript.map(({ id, speaker, text }) => ({ id, speaker, text })),
            },
            evaluation_context: {
              purpose: "Quality assurance scorecard for a customer support employee",
              evidence_rule: "Base every judgment only on the supplied transcript",
              ...(liveContext
                ? {
                    assessment_stage:
                      liveContext.revealedTurnCount === liveContext.totalTurns ? "final" : "provisional",
                    revealed_turns: liveContext.revealedTurnCount,
                    total_turns: liveContext.totalTurns,
                    guidance:
                      "For a provisional assessment, score only the behavior shown so far. Do not assume how the rest of the call unfolds.",
                  }
                : {}),
            },
          },
          questions: questions as Questions,
        })
      } finally {
        providerLatencyMs = Math.max(0, Math.round(performance.now() - providerStarted))
        await providerTiming?.onComplete?.(providerLatencyMs)
      }
      const response = await Schema.decodeUnknownPromise(WireResult)(rawResponse)

      const results = enabled.map((criterion) => {
        const scoreAnswer = response.answers[`score__${criterion.id}`]
        const evidenceAnswer = response.answers[`evidence__${criterion.id}`]
        if (!scoreAnswer || scoreAnswer.type !== "score") {
          throw new Error(`TypeSafe did not return a score for ${criterion.name}`)
        }
        if (scoreAnswer.score < 0 || scoreAnswer.score > criterion.levels.length - 1) {
          throw new Error(`TypeSafe returned an out-of-range score for ${criterion.name}`)
        }
        if (scoreAnswer.confidence < 0 || scoreAnswer.confidence > 1) {
          throw new Error(`TypeSafe returned invalid confidence for ${criterion.name}`)
        }
        if (!evidenceAnswer || evidenceAnswer.type !== "choice") {
          throw new Error(`TypeSafe did not return evidence for ${criterion.name}`)
        }
        const turn = call.transcript.find(({ id }) => id === evidenceAnswer.choice)
        return {
          criterionId: criterion.id,
          criterionName: criterion.name,
          criterionDescription: criterion.description,
          weight: criterion.weight,
          levels: criterion.levels,
          rawScore: Math.round(scoreAnswer.score * 100) / 100,
          normalizedScore:
            Math.round((scoreAnswer.score / (criterion.levels.length - 1)) * 1000) / 10,
          confidence: scoreAnswer.confidence,
          probabilities: { ...scoreAnswer.probabilities },
          evidence: turn ? { turnId: turn.id, speaker: turn.speaker, text: turn.text } : null,
        }
      })

      return {
        id: `evaluation-${crypto.randomUUID()}`,
        callId: call.id,
        runId,
        overallScore: computeWeightedScore(
          results.map((result) => ({
            rawScore: result.rawScore,
            maxScore: result.levels.length - 1,
            weight: result.weight,
          })),
        ),
        model: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        createdAt: new Date().toISOString(),
        criteria: results,
        providerLatencyMs,
        requestStartedAt,
      } satisfies Evaluation & { readonly providerLatencyMs: number; readonly requestStartedAt: string }
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
