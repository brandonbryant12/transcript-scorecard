// Shared helpers for the modality experiments. Plain Node 22+, no dependencies.
// The key is read from the environment only and is never written or logged.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const HERE = dirname(fileURLToPath(import.meta.url))
export const MEDIA = join(HERE, "media")
export const RESULTS = join(HERE, "results")
mkdirSync(MEDIA, { recursive: true })
mkdirSync(RESULTS, { recursive: true })

const KEY = process.env.GEMINI_API_KEY
if (!KEY) {
  console.error("GEMINI_API_KEY is not set. See README.md.")
  process.exit(1)
}

const BASE = "https://generativelanguage.googleapis.com/v1beta"
export const DECISION_MODEL = "gemini-decision-1"
export const TTS_MODEL = "gemini-3.8-flash-tts"

const post = async (path, body) => {
  const started = performance.now()
  const response = await fetch(`${BASE}/${path}`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const ms = Math.round(performance.now() - started)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { status: response.status, ok: response.ok, ms, json }
}

// One Decisions request. `input` is a string or an array of content blocks.
// Returns { ok, status, ms, answers, usage, error }.
export const decide = async (input, questions) => {
  const result = await post("decisions", { model: DECISION_MODEL, input, questions })
  return {
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    answers: result.json.answers ?? null,
    usage: result.json.usage ?? null,
    error: result.ok ? null : result.json.error ?? result.json,
  }
}

// Text to speech. Returns a complete WAV file (Buffer). `style` is a turn-level
// delivery instruction such as "irritated and clipped".
// Note: the docs describe an optional `sample_rate`, but gemini-3.8-flash-tts rejected
// every value other than the default with HTTP 400 on 2026-11-11, so clips are 24 kHz.
export const tts = async (text, { style, voice = "Kore" } = {}) => {
  const result = await post("interactions", {
    model: TTS_MODEL,
    input: [
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text,
            ...(style ? { annotations: [{ type: "speech_metadata", style }] } : {}),
          },
        ],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  })
  if (!result.ok) throw new Error(`TTS failed (HTTP ${result.status}): ${JSON.stringify(result.json).slice(0, 400)}`)
  const audio = (result.json.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === "audio")
    .at(-1)
  const data = audio?.data ?? result.json.output_audio?.data
  if (!data) throw new Error(`TTS returned no audio: ${JSON.stringify(result.json).slice(0, 400)}`)
  return Buffer.from(data, "base64")
}

// Ask a general (text-generating) Gemini model about media. Used only to check that the
// synthetic stimuli really carry the delivery they were asked for, independently of the
// decision model under test.
export const GENERAL_MODEL = "gemini-3.8-flash"
export const describe = async (blocks) => {
  const result = await post("interactions", { model: GENERAL_MODEL, input: blocks })
  if (!result.ok) return { ok: false, text: JSON.stringify(result.json).slice(0, 300), usage: null }
  const text = (result.json.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
  return { ok: true, text, usage: result.json.usage ?? null }
}

// --- WAV helpers -------------------------------------------------------------

// Locate the PCM payload and format of a RIFF/WAVE file.
export const parseWav = (buffer) => {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file")
  }
  let offset = 12
  let format = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    if (id === "fmt ") {
      format = {
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bitsPerSample: buffer.readUInt16LE(start + 14),
      }
    } else if (id === "data") {
      // Some encoders write 0 or 0xFFFFFFFF for a streamed data chunk.
      const end = size === 0 || size === 0xffffffff ? buffer.length : Math.min(buffer.length, start + size)
      return { ...format, pcm: buffer.subarray(start, end) }
    }
    offset = start + size + (size % 2)
  }
  throw new Error("WAV has no data chunk")
}

export const makeWav = (pcm, sampleRate = 16000, channels = 1, bitsPerSample = 16) => {
  const header = Buffer.alloc(44)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE((sampleRate * channels * bitsPerSample) / 8, 28)
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36, "ascii")
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

// Linear-interpolation resampler for 16-bit mono PCM. Good enough for speech test clips.
export const resample = (pcm, fromRate, toRate) => {
  if (fromRate === toRate) return pcm
  const inputSamples = pcm.length / 2
  const outputSamples = Math.floor((inputSamples * toRate) / fromRate)
  const out = Buffer.alloc(outputSamples * 2)
  for (let index = 0; index < outputSamples; index++) {
    const position = (index * fromRate) / toRate
    const left = Math.floor(position)
    const right = Math.min(inputSamples - 1, left + 1)
    const fraction = position - left
    const value = pcm.readInt16LE(left * 2) * (1 - fraction) + pcm.readInt16LE(right * 2) * fraction
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), index * 2)
  }
  return out
}

// Keep the first channel of interleaved 16-bit PCM.
export const firstChannel = (pcm, channels) => {
  if (channels === 1) return pcm
  const frames = Math.floor(pcm.length / (2 * channels))
  const out = Buffer.alloc(frames * 2)
  for (let frame = 0; frame < frames; frame++) out.writeInt16LE(pcm.readInt16LE(frame * 2 * channels), frame * 2)
  return out
}

// Any 16-bit WAV converted to the 16 kHz mono WAV a microphone pipeline would send.
export const toMicWav = (wav) => {
  const parsed = parseWav(wav)
  if (parsed.bitsPerSample !== 16) throw new Error(`Only 16-bit PCM is handled, got ${parsed.bitsPerSample}`)
  return makeWav(resample(firstChannel(parsed.pcm, parsed.channels), parsed.sampleRate, 16000), 16000)
}

// Root-mean-square level in dBFS: a crude loudness measure for sanity-checking stimuli.
export const rmsDb = (pcm) => {
  let sum = 0
  const samples = pcm.length / 2
  for (let index = 0; index < samples; index++) {
    const value = pcm.readInt16LE(index * 2) / 32768
    sum += value * value
  }
  return 20 * Math.log10(Math.sqrt(sum / Math.max(1, samples)) || 1e-9)
}

export const audioBlockFrom = (buffer, mimeType = "audio/wav") => ({
  type: "audio",
  data: buffer.toString("base64"),
  mime_type: mimeType,
})

export const silence = (seconds, sampleRate = 16000) => Buffer.alloc(Math.round(seconds * sampleRate) * 2)

export const seconds = (pcm, sampleRate = 16000) => pcm.length / 2 / sampleRate

// --- media and results on disk ----------------------------------------------

export const mediaPath = (name) => join(MEDIA, name)
export const hasMedia = (name) => existsSync(mediaPath(name))
export const readMedia = (name) => readFileSync(mediaPath(name))
export const writeMedia = (name, buffer) => writeFileSync(mediaPath(name), buffer)
export const b64 = (name) => readMedia(name).toString("base64")

export const audioBlock = (name, mimeType = "audio/wav") => ({ type: "audio", data: b64(name), mime_type: mimeType })
export const imageBlock = (name, resolution, mimeType = "image/jpeg") => ({
  type: "image",
  data: b64(name),
  mime_type: mimeType,
  ...(resolution ? { resolution } : {}),
})
export const textBlock = (text) => ({ type: "text", text })

// Replace base64 payloads with a reference so saved requests stay small.
export const redactInput = (input) =>
  typeof input === "string"
    ? input
    : input.map((block) =>
        block.data ? { ...block, data: `<base64 ${Math.round((block.data.length * 3) / 4)} bytes>` } : block,
      )

export const saveResult = (name, value) => {
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify(value, null, 2) + "\n")
  console.log(`saved results/${name}.json`)
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- question text shared across experiments (copied from the domain package) ---

export const SENTIMENT_LEVELS = [
  "Very negative: angry, hostile, or threatening to leave or escalate",
  "Negative: frustrated, worried, doubtful or dissatisfied",
  "Neutral: matter-of-fact, giving or asking for information with no clear feeling",
  "Positive: satisfied, relieved or appreciative",
  "Very positive: delighted or openly grateful",
]

export const VOCAL_DELIVERY = {
  name: "Vocal delivery",
  description: "How the employee sounds: calm, warm and steady rather than rushed, flat or irritated.",
  levels: [
    "Abrasive: Sounds irritated, sarcastic or condescending.",
    "Tense: Sounds rushed, impatient or flat, as if reading a script.",
    "Neutral: Even and professional, without warmth.",
    "Warm: Calm, friendly and unhurried.",
    "Reassuring: Calm and warm, with a tone that actively steadies the listener.",
  ],
  behaviors: {
    calm_pace: "The employee speaks at a calm, unhurried pace in a warm tone.",
    irritated_tone: "The employee sounds irritated, impatient or condescending.",
  },
}

export const VISUAL_PRESENCE = {
  name: "On-camera presence",
  description: "What the customer would see: attention, eye contact and an open, engaged expression.",
  levels: [
    "Disengaged: Turned away, slumped, or visibly doing something else.",
    "Distracted: Frequently looking away from the camera or at another screen.",
    "Neutral: Facing the camera with a flat or unreadable expression.",
    "Attentive: Facing the camera with steady attention.",
    "Engaged: Facing the camera with an open, responsive expression such as nodding or smiling.",
  ],
  behaviors: {
    faces_camera: "The employee is facing the camera and looking towards it.",
    looks_away: "The employee is looking away from the camera, at another screen, or appears distracted.",
  },
}

// Compact one-line view of an answer for console tables.
export const brief = (answer) => {
  if (!answer) return "-"
  if (answer.type === "noul") return `P=${answer.noul.toFixed(2)}`
  if (answer.type === "choice") return `${answer.choice} (${answer.confidence.toFixed(2)})`
  const probabilities = Object.keys(answer.probabilities)
    .sort((a, b) => Number(a) - Number(b))
    .map((level) => answer.probabilities[level].toFixed(2))
    .join(" ")
  return `${answer.score.toFixed(2)} [${probabilities}]`
}

export const tokensByModality = (usage) =>
  Object.fromEntries((usage?.input_tokens_by_modality ?? []).map((item) => [item.modality, item.tokens]))
