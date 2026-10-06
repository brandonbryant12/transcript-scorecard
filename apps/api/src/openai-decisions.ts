import { Schema } from "effect"

// Translate the shared rubric questions into the Decisions wire contract. Both
// providers receive the same instructions, transcript prefix, levels and choices.
const SharedQuestion = Schema.Union(
  Schema.Struct({ type: Schema.Literal("score"), instructions: Schema.Unknown, criteria: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.Literal("choice", "noul"), instructions: Schema.Unknown, criteria: Schema.Record({ key: Schema.String, value: Schema.String }) }),
)
const Probability = Schema.Number.pipe(Schema.between(0, 1))
const Name = Schema.NullOr(Schema.String)
const Answer = Schema.Union(
  Schema.Struct({ type: Schema.Literal("score"), name: Name, score: Schema.Number, confidence: Probability,
    probabilities: Schema.Array(Schema.Struct({ value: Schema.Number.pipe(Schema.int()), label: Schema.String, probability: Probability })) }),
  Schema.Struct({ type: Schema.Literal("choice"), name: Name, choice: Schema.String, confidence: Probability,
    probabilities: Schema.Array(Schema.Struct({ value: Schema.String, probability: Probability })) }),
  Schema.Struct({ type: Schema.Literal("predicate"), name: Name, probability: Probability }),
  Schema.Struct({ type: Schema.Literal("refusal"), name: Name }),
)
const Decision = Schema.Struct({
  model: Schema.String,
  usage: Schema.Struct({ input_tokens: Schema.Number.pipe(Schema.nonNegative()), output_tokens: Schema.Number.pipe(Schema.nonNegative()) }),
  answers: Schema.Array(Answer),
})

export const requestOpenAIDecision = async (
  state: unknown,
  sharedQuestions: Readonly<Record<string, unknown>>,
  apiKey: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
) => {
  const shared = Schema.decodeUnknownSync(Schema.Record({ key: Schema.String, value: SharedQuestion }))(sharedQuestions)
  const questions = Object.entries(shared).map(([name, question]) => {
    const instructions = JSON.stringify(question.instructions)
    if (question.type === "score") return {
      type: "score", name, instructions,
      levels: question.criteria.map((label) => ({ label })),
    }
    if (question.type === "noul") return {
      type: "predicate", name,
      instructions: `${instructions}\nYes: ${question.criteria.true}\nNo: ${question.criteria.false}`,
    }
    return { type: "choice", name, instructions,
      choices: Object.entries(question.criteria).map(([value, description]) => ({ value, description })) }
  })
  const response = await fetchImplementation("https://api.openai.com/v1/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-6-luna", input: JSON.stringify(state), questions }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  })
  // Never expose provider error bodies, which can echo credentials or input data.
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("OpenAI Decisions rejected the API credentials")
    if (response.status === 429) throw new Error("OpenAI Decisions rate limit reached; try again shortly")
    throw new Error(`OpenAI Decisions request failed (HTTP ${response.status})`)
  }
  const decision = await Schema.decodeUnknownPromise(Decision)(await response.json())
  if (decision.answers.length !== questions.length) throw new Error("OpenAI Decisions returned an incomplete answer set")
  const answers: Record<string, unknown> = {}
  decision.answers.forEach((answer, index) => {
    const expected = questions[index]!
    if (answer.name !== expected.name) throw new Error("OpenAI Decisions returned an unexpected question name")
    if (answer.type === "refusal") throw new Error(`OpenAI Decisions declined question ${expected.name}`)
    if (answer.type !== expected.type) throw new Error(`OpenAI Decisions returned an unexpected answer type for ${expected.name}`)
    if (answer.type === "score") {
      const question = shared[expected.name]!
      if (question.type !== "score") throw new Error("Invalid score question")
      const indices = new Set(answer.probabilities.map((item) => item.value))
      if (indices.size !== question.criteria.length || answer.probabilities.length !== question.criteria.length ||
          answer.probabilities.some((item) => item.value < 0 || item.value >= question.criteria.length || item.label !== question.criteria[item.value])) {
        throw new Error(`OpenAI Decisions returned invalid score levels for ${expected.name}`)
      }
      answers[expected.name] = { ...answer, legend: {},
        probabilities: Object.fromEntries(answer.probabilities.map((item) => [String(item.value), item.probability])) }
    } else if (answer.type === "choice") {
      const question = shared[expected.name]!
      if (question.type === "score" || !Object.hasOwn(question.criteria, answer.choice) ||
          answer.probabilities.length !== Object.keys(question.criteria).length ||
          new Set(answer.probabilities.map((item) => item.value)).size !== answer.probabilities.length ||
          answer.probabilities.some((item) => !Object.hasOwn(question.criteria, item.value))) {
        throw new Error(`OpenAI Decisions returned an unknown choice for ${expected.name}`)
      }
      answers[expected.name] = { ...answer,
        probabilities: Object.fromEntries(answer.probabilities.map((item) => [item.value, item.probability])) }
    } else {
      answers[expected.name] = { type: "noul", noul: answer.probability }
    }
  })
  return { model: decision.model, usage: decision.usage, answers }
}
