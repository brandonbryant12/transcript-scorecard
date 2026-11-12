// Experiments 3 and 6: per-turn clip versus whole recording for voice questions, whether
// several clips in one request can be addressed by label, and what transcript context does
// to a voice question. Uses the RAVDESS clips (same words every time, so only voice differs).
//   RAVDESS_DIR=/some/dir node 07-clip-addressing.mjs
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  audioBlockFrom,
  decide,
  makeWav,
  parseWav,
  saveResult,
  SENTIMENT_LEVELS,
  silence,
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
const CODE = { neutral: "01-01", calm: "02-02", happy: "03-02", sad: "04-02", angry: "05-02", fearful: "06-02", disgust: "07-02", surprised: "08-02" }
const clipPcm = (actor, emotion) => parseWav(toMicWav(readFileSync(join(DIR, `03-01-${CODE[emotion]}-01-01-${actor}.wav`)))).pcm

const SEQUENCES = {
  "02": ["neutral", "angry", "calm", "happy", "fearful", "sad"],
  "01": ["neutral", "angry", "calm", "fearful", "disgust", "sad"],
}
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"]
const LETTERS = ["A", "B", "C", "D", "E", "F"]
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

const voiceQuestions = (lead) => ({
  sentiment: {
    type: "score",
    instructions: `${lead} Judging by the sound of their voice (tone, pace and emphasis) rather than the words, how does the speaker feel?`,
    criteria: SENTIMENT_LEVELS,
  },
  irritated: {
    type: "noul",
    instructions: `${lead} Is this statement true of how they sound? Statement: ${VOCAL_DELIVERY.behaviors.irritated_tone.replace("The employee", "The speaker")}`,
  },
})

const output = { ranAt: new Date().toISOString(), model: "gemini-decision-1", sequences: {} }

for (const [actor, emotions] of Object.entries(SEQUENCES)) {
  const pcms = emotions.map((emotion) => clipPcm(actor, emotion))

  // Per-clip reference: one clip per request.
  const reference = []
  let perClipTokens = { text: 0, audio: 0 }
  const perClipMs = []
  for (const pcm of pcms) {
    const result = await decide([audioBlockFrom(makeWav(pcm))], voiceQuestions("Listen to the attached audio clip."))
    reference.push({ sentiment: result.answers.sentiment.score, irritated: result.answers.irritated.noul })
    const tokens = tokensByModality(result.usage)
    perClipTokens = { text: perClipTokens.text + tokens.text, audio: perClipTokens.audio + tokens.audio }
    perClipMs.push(result.ms)
    await sleep(150)
  }

  // Whole recording: the six clips joined with 0.6 s of silence.
  const parts = []
  const bounds = []
  let cursor = 0
  for (const pcm of pcms) {
    const length = pcm.length / 2 / 16000
    bounds.push([cursor, cursor + length])
    parts.push(pcm, silence(0.6))
    cursor += length + 0.6
  }
  const whole = audioBlockFrom(makeWav(Buffer.concat(parts)))
  const wholeBy = async (lead) => {
    const questions = {}
    emotions.forEach((_, index) => {
      for (const [key, question] of Object.entries(voiceQuestions(lead(index)))) questions[`u${index}_${key}`] = question
    })
    const result = await decide(
      [textBlock("One recording of the same speaker saying the same sentence six times, with a pause between each.\n"), whole],
      questions,
    )
    await sleep(200)
    return {
      ms: result.ms,
      tokens: tokensByModality(result.usage),
      values: emotions.map((_, index) => ({
        sentiment: result.answers[`u${index}_sentiment`].score,
        irritated: result.answers[`u${index}_irritated`].noul,
      })),
    }
  }
  const byTime = await wholeBy(
    (index) =>
      `Listen to the attached recording and focus only on the utterance between ${clock(bounds[index][0])} and ${clock(Math.ceil(bounds[index][1]))}.`,
  )
  const byOrdinal = await wholeBy(
    (index) => `Listen to the attached recording and focus only on the ${ORDINALS[index]} of the six utterances.`,
  )

  // Several separate clips in one request, each introduced by a text label.
  const labelled = []
  pcms.forEach((pcm, index) => {
    labelled.push(textBlock(`\nClip ${LETTERS[index]}:\n`), audioBlockFrom(makeWav(pcm)))
  })
  const labelQuestions = {}
  emotions.forEach((_, index) => {
    for (const [key, question] of Object.entries(
      voiceQuestions(`Six audio clips are attached, each introduced by a label. Listen only to the clip labelled "Clip ${LETTERS[index]}".`),
    )) {
      labelQuestions[`u${index}_${key}`] = question
    }
  })
  const labelResult = await decide(labelled, labelQuestions)
  const byLabel = {
    ms: labelResult.ms,
    tokens: tokensByModality(labelResult.usage),
    values: emotions.map((_, index) => ({
      sentiment: labelResult.answers[`u${index}_sentiment`].score,
      irritated: labelResult.answers[`u${index}_irritated`].noul,
    })),
  }

  const meanAbs = (values, key) =>
    Number((values.reduce((sum, value, index) => sum + Math.abs(value[key] - reference[index][key]), 0) / values.length).toFixed(3))
  const spread = (values, key) => Number((Math.max(...values.map((v) => v[key])) - Math.min(...values.map((v) => v[key]))).toFixed(2))
  const table = emotions.map((emotion, index) => ({
    emotion,
    perClip: reference[index],
    wholeByTime: byTime.values[index],
    wholeByOrdinal: byOrdinal.values[index],
    labelledClips: byLabel.values[index],
  }))
  output.sequences[actor] = {
    emotions,
    bounds: bounds.map(([start, end]) => [Number(start.toFixed(2)), Number(end.toFixed(2))]),
    totalSeconds: Number(cursor.toFixed(2)),
    perClip: { requests: pcms.length, ms: perClipMs, tokens: perClipTokens },
    wholeByTime: { ms: byTime.ms, tokens: byTime.tokens, meanAbsSentimentDiff: meanAbs(byTime.values, "sentiment"), meanAbsIrritatedDiff: meanAbs(byTime.values, "irritated"), irritatedSpread: spread(byTime.values, "irritated") },
    wholeByOrdinal: { ms: byOrdinal.ms, tokens: byOrdinal.tokens, meanAbsSentimentDiff: meanAbs(byOrdinal.values, "sentiment"), meanAbsIrritatedDiff: meanAbs(byOrdinal.values, "irritated"), irritatedSpread: spread(byOrdinal.values, "irritated") },
    labelledClips: { ms: byLabel.ms, tokens: byLabel.tokens, meanAbsSentimentDiff: meanAbs(byLabel.values, "sentiment"), meanAbsIrritatedDiff: meanAbs(byLabel.values, "irritated"), irritatedSpread: spread(byLabel.values, "irritated") },
    referenceIrritatedSpread: spread(reference, "irritated"),
    table,
  }
  console.log(`\nactor ${actor}  (sentiment / P(irritated))`)
  console.log("emotion    per-clip      whole:time    whole:ordinal labelled-clips")
  for (const row of table) {
    const cell = (value) => `${value.sentiment.toFixed(2)} / ${value.irritated.toFixed(2)}`.padEnd(13)
    console.log(`${row.emotion.padEnd(10)} ${cell(row.perClip)} ${cell(row.wholeByTime)} ${cell(row.wholeByOrdinal)} ${cell(row.labelledClips)}`)
  }
  const s = output.sequences[actor]
  console.log(
    `tokens  per-clip ${JSON.stringify(s.perClip.tokens)} (${s.perClip.ms.join("/")}ms) | whole ${JSON.stringify(s.wholeByTime.tokens)} ${s.wholeByTime.ms}ms | labelled ${JSON.stringify(s.labelledClips.tokens)} ${s.labelledClips.ms}ms`,
  )
  console.log(
    `mean |diff| from per-clip: time sent ${s.wholeByTime.meanAbsSentimentDiff} irr ${s.wholeByTime.meanAbsIrritatedDiff} | ordinal sent ${s.wholeByOrdinal.meanAbsSentimentDiff} irr ${s.wholeByOrdinal.meanAbsIrritatedDiff} | labelled sent ${s.labelledClips.meanAbsSentimentDiff} irr ${s.labelledClips.meanAbsIrritatedDiff}`,
  )
}

// What transcript context does to a voice question. Same clip, four framings.
const SENTENCE = "Kids are talking by the door."
const PRIOR = "[turn-1] EMPLOYEE: Thanks for holding. I've checked, and the earliest the technician can come is Thursday."
const framings = {
  audio_only: () => [],
  lane_context: () => [
    textBlock(
      `Customer support call about: Technician visit\nEMPLOYEE is Avery, the support employee being assessed. CUSTOMER is Sam.\nRecent transcript, for context:\n${PRIOR}\n[turn-2] CUSTOMER: ${SENTENCE}\nThe attached audio clip is the turn labelled [turn-2], spoken by the CUSTOMER.\n`,
    ),
  ],
  prior_turns_only: () => [
    textBlock(
      `Customer support call about: Technician visit\nEMPLOYEE is Avery, the support employee being assessed. CUSTOMER is Sam.\nTranscript so far:\n${PRIOR}\nThe attached audio clip is the CUSTOMER's reply to that turn.\n`,
    ),
  ],
  speaker_only: () => [textBlock("The attached audio clip is one turn of a customer support call, spoken by the CUSTOMER.\n")],
}
const contextRows = []
console.log("\ncontext framing: sentiment / P(irritated) per clip")
for (const actor of ["01", "02"]) {
  for (const emotion of ["neutral", "angry", "fearful", "happy"]) {
    const audio = audioBlockFrom(makeWav(clipPcm(actor, emotion)))
    const row = { actor, emotion }
    for (const [name, blocks] of Object.entries(framings)) {
      const result = await decide(
        [...blocks(), audio],
        voiceQuestions("Listen to the attached audio clip of the CUSTOMER."),
      )
      row[name] = { sentiment: result.answers.sentiment.score, irritated: result.answers.irritated.noul, tokens: tokensByModality(result.usage) }
      await sleep(150)
    }
    contextRows.push(row)
    console.log(
      `actor ${actor} ${emotion.padEnd(8)} ` +
        Object.keys(framings)
          .map((name) => `${name}=${row[name].sentiment.toFixed(2)}/${row[name].irritated.toFixed(2)}`)
          .join("  "),
    )
  }
}
output.contextFraming = { sentence: SENTENCE, prior: PRIOR, rows: contextRows }
saveResult("07-clip-addressing", output)
