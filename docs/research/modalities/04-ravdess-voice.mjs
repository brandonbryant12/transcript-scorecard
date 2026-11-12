// Experiment 1b: acted human speech with emotionally neutral words (RAVDESS).
// Every clip says "Kids are talking by the door", so any difference between clips is voice.
// The recordings are licensed CC BY-NC-SA 4.0 and are not kept in this repository:
//   python3 -I fetch-ravdess.py /some/dir && RAVDESS_DIR=/some/dir node 04-ravdess-voice.mjs
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  audioBlockFrom,
  brief,
  decide,
  describe,
  parseWav,
  rmsDb,
  saveResult,
  seconds,
  SENTIMENT_LEVELS,
  sleep,
  textBlock,
  tokensByModality,
  toMicWav,
  VOCAL_DELIVERY,
} from "./lib.mjs"

const DIR = process.env.RAVDESS_DIR
if (!DIR) {
  console.error("Set RAVDESS_DIR to the folder written by fetch-ravdess.py")
  process.exit(1)
}
const EMOTION = { "01": "neutral", "02": "calm", "03": "happy", "04": "sad", "05": "angry", "06": "fearful", "07": "disgust", "08": "surprised" }
const SENTENCE = "Kids are talking by the door."

const ACTED = {
  angry: "Angry or hostile.",
  calm: "Calm and relaxed.",
  disgust: "Disgusted or contemptuous.",
  fearful: "Afraid or panicked.",
  happy: "Happy or cheerful.",
  neutral: "Neutral, no particular feeling.",
  sad: "Sad or dejected.",
  surprised: "Surprised or astonished.",
}

const audioQuestions = {
  sentiment_voice: {
    type: "score",
    instructions:
      "Listen to the attached audio clip of the CUSTOMER. Judging by the sound of their voice (tone, pace and emphasis) rather than the words, how does the customer feel?",
    criteria: SENTIMENT_LEVELS,
  },
  acted_emotion: {
    type: "choice",
    instructions:
      "Listen to the attached audio clip. Judging only by the sound of the voice, which emotion is the speaker expressing?",
    criteria: ACTED,
  },
  delivery: {
    type: "score",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Rate "${VOCAL_DELIVERY.name}": ${VOCAL_DELIVERY.description} Judge only how the employee sounds in this clip, not the words they chose. Choose the level whose description fits best.`,
    criteria: VOCAL_DELIVERY.levels,
  },
  calm_pace: {
    type: "noul",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Is this statement true of how they sound in the clip? Statement: ${VOCAL_DELIVERY.behaviors.calm_pace}`,
  },
  irritated_tone: {
    type: "noul",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Is this statement true of how they sound in the clip? Statement: ${VOCAL_DELIVERY.behaviors.irritated_tone}`,
  },
}

const textQuestions = {
  sentiment_plain: { type: "score", instructions: "How does the CUSTOMER feel in this turn?", criteria: SENTIMENT_LEVELS },
}

const baseline = await decide(`CUSTOMER: ${SENTENCE}`, textQuestions)
console.log(`text-only baseline: sentiment=${brief(baseline.answers.sentiment_plain)}`)

const files = readdirSync(DIR).filter((name) => name.endsWith(".wav")).sort()
const rows = []
for (const file of files) {
  const [, , emotionCode, , , , actor] = file.replace(".wav", "").split("-")
  const emotion = EMOTION[emotionCode]
  const wav = toMicWav(readFileSync(join(DIR, file)))
  const pcm = parseWav(wav).pcm
  const audio = audioBlockFrom(wav)
  const audioOnly = await decide([audio], audioQuestions)
  // The same clip with its transcript alongside, as the project's media lane sends it.
  const withText = await decide(
    [textBlock(`Recent transcript, for context:\n[turn-1] CUSTOMER: ${SENTENCE}\nThe attached audio clip is the turn labelled [turn-1], spoken by the CUSTOMER.\n`), audio],
    audioQuestions,
  )
  // A second, general-purpose listener, to tell "the decision model is deaf to this" from
  // "this is hard for any model".
  const second = await describe([
    textBlock(
      "Listen to this clip. Judging only by the sound of the voice, answer with exactly one word from: neutral, calm, happy, sad, angry, fearful, disgust, surprised.",
    ),
    audio,
  ])
  const row = {
    file,
    actor,
    emotion,
    seconds: Number(seconds(pcm).toFixed(2)),
    rmsDb: Number(rmsDb(pcm).toFixed(1)),
    audioOnly: { ms: audioOnly.ms, tokens: tokensByModality(audioOnly.usage), answers: audioOnly.answers, error: audioOnly.error },
    withText: { ms: withText.ms, tokens: tokensByModality(withText.usage), answers: withText.answers, error: withText.error },
    generalModel: second.text.toLowerCase().replace(/[^a-z]/g, ""),
  }
  rows.push(row)
  const a = audioOnly.answers ?? {}
  const t = withText.answers ?? {}
  console.log(
    `actor ${actor} ${emotion.padEnd(9)} ${row.seconds}s ${String(row.rmsDb).padStart(6)}dB | audio: sent=${a.sentiment_voice?.score.toFixed(2)} acted=${a.acted_emotion?.choice}(${a.acted_emotion?.confidence.toFixed(2)}) deliv=${a.delivery?.score.toFixed(2)} calm=${a.calm_pace?.noul.toFixed(2)} irr=${a.irritated_tone?.noul.toFixed(2)} | +text: sent=${t.sentiment_voice?.score.toFixed(2)} acted=${t.acted_emotion?.choice} irr=${t.irritated_tone?.noul.toFixed(2)} | flash: ${row.generalModel}`,
  )
  await sleep(150)
}

saveResult("04-ravdess-voice", {
  ranAt: new Date().toISOString(),
  model: "gemini-decision-1",
  source: "RAVDESS (CC BY-NC-SA 4.0), actors 01 and 02, statement 01, strong intensity (neutral: normal)",
  sentence: SENTENCE,
  textOnlyBaseline: baseline.answers,
  questions: audioQuestions,
  rows,
})
