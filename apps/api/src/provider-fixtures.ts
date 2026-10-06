// Deterministic wire responses for transport-mocked integration/UI verification.
export const providerFixture = (openai: boolean, body: Record<string, unknown>) => {
  const questions: Array<Record<string, unknown>> = openai
    ? body.questions as Array<Record<string, unknown>>
    : Object.entries(body.questions as Record<string, Record<string, unknown>>).map(([name, value]) => ({ ...value, name }))
  const answers = questions.map((question) => {
    const name = String(question.name)
    if (question.type === "score") {
      const labels = openai
        ? (question.levels as Array<{ label: string }>).map(({ label }) => label)
        : question.criteria as string[]
      const score = labels.length - (openai ? 1 : 2)
      const distribution = labels.map((label, value) => ({ label, value, probability: value === score ? 1 : 0 }))
      return { name, type: "score", score, confidence: .9,
        probabilities: openai ? distribution : Object.fromEntries(distribution.map((item) => [String(item.value), item.probability])), legend: {} }
    }
    if (question.type === "predicate" || question.type === "noul") return openai
      ? { name, type: "predicate", probability: .8 }
      : { name, type: "noul", noul: .8 }
    const values = openai
      ? (question.choices as Array<{ value: string }>).map(({ value }) => value)
      : Object.keys(question.criteria as object)
    const choice = values.includes("neutral") ? "neutral" : values.find((value) => value !== "none") ?? "none"
    const distribution = values.map((value) => ({ value, probability: value === choice ? 1 : 0 }))
    return { name, type: "choice", choice, confidence: .9,
      probabilities: openai ? distribution : Object.fromEntries(distribution.map((item) => [item.value, item.probability])) }
  })
  return { model: openai ? "gpt-6-luna" : "jev-test", usage: { input_tokens: 1000, output_tokens: 0 },
    answers: openai ? answers : Object.fromEntries(answers.map((answer) => [answer.name, answer])) }
}
