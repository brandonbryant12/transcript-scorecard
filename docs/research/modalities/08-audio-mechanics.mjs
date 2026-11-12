// Experiment 6 (audio half): mechanics. Which audio encodings are accepted, how tokens and
// latency scale with duration, and what silence, very short clips and telephone-band audio do.
// Needs ffmpeg on PATH for the compressed formats. RAVDESS_DIR is optional (telephone test).
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  audioBlockFrom,
  decide,
  makeWav,
  mediaPath,
  parseWav,
  readMedia,
  resample,
  saveResult,
  silence,
  sleep,
  tokensByModality,
  toMicWav,
  VOCAL_DELIVERY,
} from "./lib.mjs"

const work = mkdtempSync(join(tmpdir(), "modalities-"))
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args])

// A probe that only passes if the words were actually heard at the right speed.
const HEARD = {
  heard_words: {
    type: "noul",
    instructions: 'Listen to the attached audio clip. Does the speaker say the words "let me look into that"?',
  },
  heard_other: {
    type: "noul",
    instructions: 'Listen to the attached audio clip. Does the speaker say the words "your refund has been approved"?',
  },
}

const source = mediaPath("c_warm_calm.wav")
const wav16 = readMedia("c_warm_calm.wav")
const pcm16 = parseWav(wav16).pcm
const encoded = (extension, args) => {
  const target = join(work, `clip.${extension}`)
  ffmpeg(["-i", source, ...args, target])
  return readFileSync(target)
}

const formats = [
  ["audio/wav", "WAV 16 kHz 16-bit mono", wav16],
  ["audio/wav", "WAV 8 kHz 16-bit mono", makeWav(resample(pcm16, 16000, 8000), 8000)],
  ["audio/wav", "WAV 8 kHz mu-law (telephony)", encoded("mulaw.wav", ["-ar", "8000", "-c:a", "pcm_mulaw"])],
  ["audio/l16", "raw PCM, no rate given", pcm16],
  ["audio/l16;rate=16000", "raw PCM, rate parameter", pcm16],
  ["audio/pcm;rate=16000", "raw PCM, Live API style MIME", pcm16],
  ["audio/mp3", "MP3 32 kbps", encoded("mp3", ["-b:a", "32k"])],
  ["audio/mpeg", "MP3 labelled audio/mpeg", encoded("mp3", ["-b:a", "32k"])],
  ["audio/m4a", "AAC in M4A", encoded("m4a", ["-c:a", "aac", "-b:a", "32k"])],
  ["audio/aac", "AAC ADTS", encoded("aac", ["-c:a", "aac", "-b:a", "32k"])],
  ["audio/ogg", "Opus in Ogg", encoded("ogg", ["-c:a", "libopus", "-b:a", "24k"])],
  ["audio/webm", "Opus in WebM (MediaRecorder default)", encoded("webm", ["-c:a", "libopus", "-b:a", "24k"])],
  ["audio/flac", "FLAC", encoded("flac", [])],
  ["application/octet-stream", "WAV bytes, generic MIME", wav16],
  ["audio/mp3", "WAV bytes labelled as MP3", wav16],
]

const formatRows = []
console.log("format acceptance")
for (const [mimeType, label, bytes] of formats) {
  const result = await decide([audioBlockFrom(bytes, mimeType)], HEARD)
  const row = {
    mimeType,
    label,
    bytes: bytes.length,
    status: result.status,
    ms: result.ms,
    tokens: tokensByModality(result.usage),
    heardWords: result.answers?.heard_words.noul ?? null,
    heardOther: result.answers?.heard_other.noul ?? null,
    error: result.error,
  }
  formatRows.push(row)
  console.log(
    `${mimeType.padEnd(26)} ${label.padEnd(38)} ${String(bytes.length).padStart(7)}B HTTP ${result.status} ` +
      (result.ok
        ? `audio=${row.tokens.audio} heard=${row.heardWords.toFixed(2)} other=${row.heardOther.toFixed(2)} ${result.ms}ms`
        : JSON.stringify(result.error).slice(0, 160)),
  )
  await sleep(150)
}

// Degenerate clips.
const speech = pcm16
const degenerate = [
  ["3 s of digital silence", makeWav(silence(3))],
  ["0.25 s of speech", makeWav(speech.subarray(16000 * 2 * 1, 16000 * 2 * 1 + 8000))],
  ["0.05 s of speech", makeWav(speech.subarray(16000 * 2 * 1, 16000 * 2 * 1 + 1600))],
  ["empty WAV (header only)", makeWav(Buffer.alloc(0))],
]
const delivery = {
  delivery: {
    type: "score",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Rate "${VOCAL_DELIVERY.name}": ${VOCAL_DELIVERY.description} Judge only how the employee sounds in this clip, not the words they chose. Choose the level whose description fits best.`,
    criteria: VOCAL_DELIVERY.levels,
  },
  irritated: {
    type: "noul",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Is this statement true of how they sound in the clip? Statement: ${VOCAL_DELIVERY.behaviors.irritated_tone}`,
  },
  any_speech: { type: "noul", instructions: "Listen to the attached audio clip. Can a person be heard speaking?" },
}
const degenerateRows = []
console.log("\ndegenerate clips")
for (const [label, bytes] of degenerate) {
  const result = await decide([audioBlockFrom(bytes)], delivery)
  degenerateRows.push({ label, status: result.status, tokens: tokensByModality(result.usage), answers: result.answers, error: result.error })
  console.log(
    `${label.padEnd(26)} HTTP ${result.status} ` +
      (result.ok
        ? `audio=${tokensByModality(result.usage).audio} speech=${result.answers.any_speech.noul.toFixed(2)} irritated=${result.answers.irritated.noul.toFixed(2)} delivery=${result.answers.delivery.score.toFixed(2)} conf=${result.answers.delivery.confidence.toFixed(2)} [${Object.values(result.answers.delivery.probabilities).map((p) => p.toFixed(2)).join(" ")}]`
        : JSON.stringify(result.error).slice(0, 200)),
  )
  await sleep(150)
}

// Tokens and latency against duration: the 67 s call cut short or repeated.
const callPcm = parseWav(readMedia("call.wav")).pcm
const callSeconds = callPcm.length / 2 / 16000
const ONE = { security: { type: "noul", instructions: "Listen to the attached recording of a support call. Does the employee offer to change the account without verification?" } }
const scaleRows = []
console.log("\ntokens and latency against duration (one question)")
for (const target of [5, 15, 30, 67, 134, 268, 536]) {
  const copies = Math.ceil(target / callSeconds)
  const pcm = Buffer.concat(Array.from({ length: copies }, () => callPcm)).subarray(0, Math.round(target * 16000) * 2)
  const timings = []
  let tokens = null
  let status = 0
  let error = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await decide([audioBlockFrom(makeWav(pcm))], ONE)
    status = result.status
    error = result.error
    if (!result.ok) break
    timings.push(result.ms)
    tokens = tokensByModality(result.usage)
    await sleep(150)
  }
  const row = { seconds: target, bytes: pcm.length + 44, status, tokens, ms: timings, error }
  scaleRows.push(row)
  console.log(
    `${String(target).padStart(4)}s ${String(Math.round(row.bytes / 1024)).padStart(6)}KB HTTP ${status} ` +
      (tokens ? `audio=${tokens.audio} (${(tokens.audio / target).toFixed(1)}/s) latency=${timings.join("/")}ms` : JSON.stringify(error).slice(0, 160)),
  )
}

// Telephone band: does voice signal survive 8 kHz and mu-law? (Real acted speech.)
const telephoneRows = []
const DIR = process.env.RAVDESS_DIR
if (DIR && existsSync(DIR)) {
  console.log("\ntelephone band on acted speech: P(irritated) / delivery")
  for (const [emotion, code] of [["neutral", "01-01"], ["angry", "05-02"], ["fearful", "06-02"]]) {
    for (const actor of ["01", "02"]) {
      const original = join(DIR, `03-01-${code}-01-01-${actor}.wav`)
      const wide = toMicWav(readFileSync(original))
      const narrow = makeWav(resample(parseWav(wide).pcm, 16000, 8000), 8000)
      const mulawPath = join(work, `tel-${actor}-${emotion}.wav`)
      ffmpeg(["-i", original, "-ac", "1", "-ar", "8000", "-c:a", "pcm_mulaw", mulawPath])
      const row = { actor, emotion }
      for (const [name, bytes] of [["wav16k", wide], ["wav8k", narrow], ["mulaw8k", readFileSync(mulawPath)]]) {
        const result = await decide([audioBlockFrom(bytes)], delivery)
        row[name] = result.ok
          ? { irritated: result.answers.irritated.noul, delivery: result.answers.delivery.score, audioTokens: tokensByModality(result.usage).audio }
          : { error: result.error }
        await sleep(150)
      }
      telephoneRows.push(row)
      console.log(
        `actor ${actor} ${emotion.padEnd(8)} ` +
          ["wav16k", "wav8k", "mulaw8k"].map((name) => `${name}=${row[name].irritated?.toFixed(2)}/${row[name].delivery?.toFixed(2)}`).join("  "),
      )
    }
  }
}

saveResult("08-audio-mechanics", {
  ranAt: new Date().toISOString(),
  model: "gemini-decision-1",
  formats: formatRows,
  degenerate: degenerateRows,
  scaling: scaleRows,
  telephone: telephoneRows,
})
