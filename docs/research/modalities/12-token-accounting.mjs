// Token accounting for text: what the transcript itself costs, and what each question costs.
import { readFileSync } from "node:fs"
import { decide, mediaPath, saveResult, SENTIMENT_LEVELS, sleep, tokensByModality } from "./lib.mjs"

const call = JSON.parse(readFileSync(mediaPath("call.json"), "utf8"))
const transcript = call.turns.map((turn) => `[${turn.id}] ${turn.speaker.toUpperCase()}: ${turn.text}`).join("\n")
const noul = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, { type: "noul", instructions: "Focus on the single turn labelled [turn-7]; treat every other turn as context only. Is this statement true of that turn? Statement: The employee commits to a specific next step with an owner, a timeframe or a reference number." }]))
const score = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`s${i}`, { type: "score", instructions: "Focus on the single turn labelled [turn-2]; treat every other turn as context only. How does the CUSTOMER feel in that turn?", criteria: SENTIMENT_LEVELS }]))

const rows = []
const run = async (label, input, questions) => {
  const timings = []
  let tokens
  for (let i = 0; i < 3; i++) {
    const result = await decide(input, questions)
    timings.push(result.ms)
    tokens = tokensByModality(result.usage).text
    await sleep(120)
  }
  rows.push({ label, questions: Object.keys(questions).length, textTokens: tokens, ms: timings })
  console.log(`${label.padEnd(44)} ${String(Object.keys(questions).length).padStart(4)} q  ${String(tokens).padStart(6)} tok  ${timings.join("/")}ms`)
}
await run("one-character input, 1 yes/no", "x", noul(1))
await run("transcript (12 turns, 67 s spoken), 1 yes/no", transcript, noul(1))
await run("transcript, 10 yes/no", transcript, noul(10))
await run("transcript, 100 yes/no", transcript, noul(100))
await run("transcript, 300 yes/no", transcript, noul(300))
await run("transcript, 1 five-level rubric", transcript, score(1))
await run("transcript, 10 five-level rubrics", transcript, score(10))
saveResult("12-token-accounting", { ranAt: new Date().toISOString(), words: transcript.split(/\s+/).length, seconds: call.totalSeconds, rows })
