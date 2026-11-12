// Generate the synthetic speech clips used by experiments 1, 3, 5 and 6.
// gemini-3.8-flash-tts returns 24 kHz WAV; clips are stored resampled to 16 kHz mono 16-bit,
// the format a microphone pipeline (and the Live API input) uses. All content is fictional.
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { hasMedia, MEDIA, parseWav, seconds, sleep, toMicWav, tts, writeMedia } from "./lib.mjs"

const NEUTRAL = "Fine. I'll wait for the email then."
const EMPLOYEE = "I understand. Let me look into that for you right now."

export const CLIPS = [
  // Set A: one neutral customer sentence, five deliveries.
  { id: "a_calm_warm", set: "A", speaker: "customer", voice: "Puck", text: NEUTRAL, style: "calm, warm and content, with a smile in the voice" },
  { id: "a_flat", set: "A", speaker: "customer", voice: "Puck", text: NEUTRAL, style: "monotone and flat, no emotion at all" },
  { id: "a_irritated", set: "A", speaker: "customer", voice: "Puck", text: NEUTRAL, style: "irritated and clipped, angry tone, through gritted teeth" },
  { id: "a_anxious", set: "A", speaker: "customer", voice: "Puck", text: NEUTRAL, style: "anxious and rushed, worried, speaking rapidly with a shaky voice" },
  { id: "a_relieved", set: "A", speaker: "customer", voice: "Puck", text: NEUTRAL, style: "relieved and grateful, like a weight has lifted" },
  // Set B: words and delivery point in opposite directions.
  { id: "b_polite_words_angry_voice", set: "B", speaker: "customer", voice: "Puck", text: "Thank you so much for your help today. I really appreciate it.", style: "furious and sarcastic, biting, spitting the words out" },
  { id: "b_angry_words_warm_voice", set: "B", speaker: "customer", voice: "Puck", text: "This is completely unacceptable and I want to cancel.", style: "cheerful and laughing, joking warmly with a friend" },
  { id: "b_neutral_words_panicked_voice", set: "B", speaker: "customer", voice: "Puck", text: "Can you tell me when it will be fixed?", style: "panicked, voice shaking, close to tears" },
  { id: "b_polite_words_warm_voice", set: "B", speaker: "customer", voice: "Puck", text: "Thank you so much for your help today. I really appreciate it.", style: "sincere, warm and grateful" },
  // Set C: one neutral employee sentence, four deliveries (for the vocal delivery rubric).
  { id: "c_warm_calm", set: "C", speaker: "employee", voice: "Kore", text: EMPLOYEE, style: "calm, warm, unhurried and reassuring" },
  { id: "c_rushed", set: "C", speaker: "employee", voice: "Kore", text: EMPLOYEE, style: "rushed and impatient, speaking very rapidly" },
  { id: "c_irritated", set: "C", speaker: "employee", voice: "Kore", text: EMPLOYEE, style: "irritated and condescending, exasperated" },
  { id: "c_flat_script", set: "C", speaker: "employee", voice: "Kore", text: EMPLOYEE, style: "monotone and flat, bored, as if reading a script" },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifest = []
  for (const clip of CLIPS) {
    const file = `${clip.id}.wav`
    if (!hasMedia(file)) {
      const wav = await tts(clip.text, { style: clip.style, voice: clip.voice })
      writeMedia(file, toMicWav(wav))
      await sleep(400)
    }
    const { readFileSync } = await import("node:fs")
    const parsed = parseWav(readFileSync(join(MEDIA, file)))
    const entry = {
      ...clip,
      file: `media/${file}`,
      sampleRate: parsed.sampleRate,
      channels: parsed.channels,
      seconds: Number(seconds(parsed.pcm, parsed.sampleRate).toFixed(2)),
      bytes: parsed.pcm.length + 44,
    }
    manifest.push(entry)
    console.log(`${entry.id.padEnd(32)} ${String(entry.seconds).padStart(5)}s ${entry.sampleRate}Hz ${entry.bytes} bytes`)
  }
  writeFileSync(join(MEDIA, "speech-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
}
