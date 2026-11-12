// Experiment 2: can a recording replace the transcript?
// The same turn-level behaviour questions and call-level rubric are asked against
//   A  the labelled transcript (how the project does it)
//   B  the whole recording only, addressing a turn by time range, by ordinal, or by quote
//   C  transcript + whole recording
//   D  one clip per employee turn, no transcript
import { readFileSync } from "node:fs"
import {
  audioBlock,
  audioBlockFrom,
  decide,
  makeWav,
  mediaPath,
  parseWav,
  readMedia,
  saveResult,
  sleep,
  textBlock,
  tokensByModality,
} from "./lib.mjs"

const call = JSON.parse(readFileSync(mediaPath("call.json"), "utf8"))
const turns = call.turns
const employeeTurns = turns.filter((turn) => turn.speaker === "employee")

const BEHAVIORS = {
  acknowledges_emotion:
    "The employee explicitly acknowledges how the customer feels, the pressure they are under, or the effort they have already made.",
  verifies_identity:
    "The employee asks the customer to prove their own identity with security details, or confirms that the security details the customer gave match the account.",
  unverified_change:
    "The employee makes, or offers to make, a change to account access, credentials or contact details without verifying the identity of the person affected.",
  unsupported_promise:
    "The employee guarantees an outcome or timeframe that is outside their control or that contradicts what they said earlier.",
  owned_next_step:
    "The employee commits to a specific next step with an owner, a timeframe or a reference number.",
}

// What a careful reader would mark. Cells not listed are false; `null` cells are arguable
// and left out of the accuracy figures.
const TRUTH = {
  "turn-3": { acknowledges_emotion: true, verifies_identity: true },
  "turn-5": { verifies_identity: true, owned_next_step: null },
  "turn-7": { unverified_change: true },
  "turn-9": { unsupported_promise: true },
  "turn-11": { owned_next_step: true },
}
const truthOf = (turnId, behaviorId) => {
  const cell = TRUTH[turnId]?.[behaviorId]
  return cell === undefined ? false : cell
}

const SECURITY_LEVELS = [
  "Breach: Changes or exposes account access or personal details with no identity verification.",
  "Risky: Offers to skip verification, or verifies only after acting on the account.",
  "Partial: Verifies, but incompletely or inconsistently across the call.",
  "Sound: Verifies identity before accessing or changing the account.",
  "Exemplary: Verifies before acting, explains why, and protects the account when asked to bend the rules.",
]
const securityQuestion = (source) => ({
  type: "score",
  instructions: `Rate the EMPLOYEE on "Security & verification": Verifies identity before touching the account and refuses to bend that rule. Judge only what the ${source} shows. Choose the level whose description fits best.`,
  criteria: SECURITY_LEVELS,
})

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"]

const HEADER =
  "Customer support call. The first speaker is the EMPLOYEE (Avery, the support agent being assessed); the other speaker is the CUSTOMER."
const transcript = [
  HEADER,
  "This is the complete call.",
  "",
  ...turns.map((turn) => `[${turn.id}] ${turn.speaker.toUpperCase()}: ${turn.text}`),
].join("\n")

// How a question points at one employee turn in each condition.
const address = {
  label: (turn) => `Focus on the single turn labelled [${turn.id}]; treat every other turn as context only.`,
  time: (turn) =>
    `Focus on what the EMPLOYEE says between ${clock(turn.startSeconds)} and ${clock(Math.ceil(turn.endSeconds))} of the attached recording; treat the rest as context only.`,
  ordinal: (turn) =>
    `Focus on the ${ORDINALS[employeeTurns.indexOf(turn)]} time the EMPLOYEE speaks in the attached recording (the EMPLOYEE speaks first, then the speakers alternate); treat the rest as context only.`,
  quote: (turn) =>
    `Focus on the part of the attached recording where the EMPLOYEE says "${turn.text.split(" ").slice(0, 7).join(" ")}..."; treat the rest as context only.`,
}

const tagQuestions = (addressing, tail) =>
  Object.fromEntries(
    employeeTurns.flatMap((turn) =>
      Object.entries(BEHAVIORS).map(([behaviorId, statement]) => [
        `${turn.id}__${behaviorId}`,
        { type: "noul", instructions: `${address[addressing](turn)} Is this statement true of ${tail}? Statement: ${statement}` },
      ]),
    ),
  )

const audio = audioBlock("call.wav")
const conditions = [
  { id: "A_transcript", input: transcript, questions: { ...tagQuestions("label", "that turn"), security: securityQuestion("transcript") } },
  { id: "B_audio_time", input: [textBlock(HEADER + "\n"), audio], questions: { ...tagQuestions("time", "that part"), security: securityQuestion("recording") } },
  { id: "B_audio_ordinal", input: [textBlock(HEADER + "\n"), audio], questions: { ...tagQuestions("ordinal", "that part"), security: securityQuestion("recording") } },
  { id: "B_audio_quote", input: [textBlock(HEADER + "\n"), audio], questions: { ...tagQuestions("quote", "that part"), security: securityQuestion("recording") } },
  { id: "C_transcript_audio", input: [textBlock(transcript + "\n\nThe attached recording is the audio of this call.\n"), audio], questions: { ...tagQuestions("label", "that turn"), security: securityQuestion("transcript and recording") } },
]

const score = (answers, keyOf) => {
  const cells = []
  for (const turn of employeeTurns) {
    for (const behaviorId of Object.keys(BEHAVIORS)) {
      const truth = truthOf(turn.id, behaviorId)
      const probability = answers[keyOf(turn, behaviorId)]?.noul
      if (truth === null || probability === undefined) continue
      cells.push({ turn: turn.id, behaviorId, truth, probability })
    }
  }
  const positives = cells.filter((cell) => cell.truth)
  const negatives = cells.filter((cell) => !cell.truth)
  const correct = cells.filter((cell) => cell.probability >= 0.6 === cell.truth).length
  return {
    positives: positives.map((cell) => `${cell.turn}/${cell.behaviorId}=${cell.probability.toFixed(2)}`),
    meanPositive: Number((positives.reduce((sum, cell) => sum + cell.probability, 0) / positives.length).toFixed(3)),
    meanNegative: Number((negatives.reduce((sum, cell) => sum + cell.probability, 0) / negatives.length).toFixed(3)),
    falsePositives: negatives.filter((cell) => cell.probability >= 0.6).map((cell) => `${cell.turn}/${cell.behaviorId}=${cell.probability.toFixed(2)}`),
    missed: positives.filter((cell) => cell.probability < 0.6).map((cell) => `${cell.turn}/${cell.behaviorId}=${cell.probability.toFixed(2)}`),
    accuracyAt06: `${correct}/${cells.length}`,
  }
}

const results = []
for (const condition of conditions) {
  const result = await decide(condition.input, condition.questions)
  if (!result.ok) {
    console.log(condition.id, "FAILED", JSON.stringify(result.error))
    results.push({ id: condition.id, error: result.error })
    continue
  }
  const summary = score(result.answers, (turn, behaviorId) => `${turn.id}__${behaviorId}`)
  results.push({
    id: condition.id,
    ms: result.ms,
    tokens: tokensByModality(result.usage),
    totalInputTokens: result.usage.total_input_tokens,
    questionCount: Object.keys(condition.questions).length,
    security: result.answers.security,
    summary,
    answers: result.answers,
    exampleQuestion: Object.values(condition.questions)[15].instructions,
  })
  console.log(
    `${condition.id.padEnd(20)} ${String(result.ms).padStart(5)}ms tokens=${JSON.stringify(tokensByModality(result.usage))} security=${result.answers.security.score.toFixed(2)} acc=${summary.accuracyAt06} meanPos=${summary.meanPositive} meanNeg=${summary.meanNegative}\n    missed=${summary.missed.join(", ") || "-"}\n    falsePos=${summary.falsePositives.join(", ") || "-"}`,
  )
  await sleep(300)
}

// D: one clip per employee turn, nothing else. Audio as the only carrier of the words.
const callPcm = parseWav(readMedia("call.wav")).pcm
const clipOf = (turn) =>
  makeWav(callPcm.subarray(Math.round(turn.startSeconds * 16000) * 2, Math.round(turn.endSeconds * 16000) * 2), 16000)
const clipAnswers = {}
let clipTokens = { text: 0, audio: 0 }
let clipMs = []
for (const turn of employeeTurns) {
  const questions = Object.fromEntries(
    Object.entries(BEHAVIORS).map(([behaviorId, statement]) => [
      `${turn.id}__${behaviorId}`,
      { type: "noul", instructions: `Listen to the attached audio clip of the EMPLOYEE in a customer support call. Is this statement true of what they say in the clip? Statement: ${statement}` },
    ]),
  )
  const result = await decide([audioBlockFrom(clipOf(turn))], questions)
  if (!result.ok) {
    console.log("D clip", turn.id, "FAILED", JSON.stringify(result.error))
    continue
  }
  Object.assign(clipAnswers, result.answers)
  const tokens = tokensByModality(result.usage)
  clipTokens = { text: clipTokens.text + (tokens.text ?? 0), audio: clipTokens.audio + (tokens.audio ?? 0) }
  clipMs.push(result.ms)
  await sleep(200)
}
const clipSummary = score(clipAnswers, (turn, behaviorId) => `${turn.id}__${behaviorId}`)
results.push({ id: "D_clip_per_turn", requests: employeeTurns.length, ms: clipMs, tokens: clipTokens, summary: clipSummary, answers: clipAnswers })
console.log(
  `D_clip_per_turn      ${clipMs.join("/")}ms tokens=${JSON.stringify(clipTokens)} acc=${clipSummary.accuracyAt06} meanPos=${clipSummary.meanPositive} meanNeg=${clipSummary.meanNegative}\n    missed=${clipSummary.missed.join(", ") || "-"}\n    falsePos=${clipSummary.falsePositives.join(", ") || "-"}`,
)

saveResult("06-audio-vs-transcript", {
  ranAt: new Date().toISOString(),
  model: "gemini-decision-1",
  call: { totalSeconds: call.totalSeconds, turns },
  truth: TRUTH,
  behaviors: BEHAVIORS,
  results,
})
