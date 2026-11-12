// Build one two-speaker call recording from per-turn TTS, with known turn boundaries.
// Output: media/call.wav (16 kHz mono) and media/call.json (text, start and end of each turn).
import { writeFileSync } from "node:fs"
import { hasMedia, makeWav, mediaPath, parseWav, resample, silence, sleep, tts, writeMedia } from "./lib.mjs"

export const CALL_TURNS = [
  ["employee", "ACME Support, Avery speaking. What is happening with your device?"],
  ["customer", "My hub has been offline since yesterday, and I already restarted it twice. I'm pretty frustrated."],
  ["employee", "I'm sorry, that sounds really frustrating. Before I open the account, can you confirm the postal code on it?"],
  ["customer", "It's nine eight one zero nine."],
  ["employee", "Thanks, that matches. I can see a failed firmware update, so I'm sending a recovery command now."],
  ["customer", "I have to leave soon. Can my partner call back if it doesn't finish?"],
  ["employee", "Sure, I'll just add them to the account now. Give me their name and email, no verification needed."],
  ["customer", "Don't they need to verify themselves first?"],
  ["employee", "It's fine. And I guarantee the hub will be back online within ten minutes."],
  ["customer", "You guarantee it? Please give me a case number."],
  ["employee", "The case number is T H seven seven one four. I'll email you a summary and call you tomorrow at ten to confirm it's working."],
  ["customer", "Okay, thank you."],
]

const GAP_SECONDS = 0.5
const RATE = 16000

if (import.meta.url === `file://${process.argv[1]}`) {
  if (hasMedia("call.wav")) {
    console.log("media/call.wav already exists; delete it to rebuild")
    process.exit(0)
  }
  const parts = []
  const turns = []
  let cursor = 0
  for (const [index, [speaker, text]] of CALL_TURNS.entries()) {
    const wav = await tts(text, { voice: speaker === "employee" ? "Kore" : "Puck" })
    const parsed = parseWav(wav)
    const pcm = resample(parsed.pcm, parsed.sampleRate, RATE)
    const length = pcm.length / 2 / RATE
    turns.push({
      id: `turn-${index + 1}`,
      speaker,
      text,
      startSeconds: Number(cursor.toFixed(2)),
      endSeconds: Number((cursor + length).toFixed(2)),
    })
    parts.push(pcm, silence(GAP_SECONDS, RATE))
    cursor += length + GAP_SECONDS
    console.log(`turn-${index + 1} ${speaker.padEnd(8)} ${length.toFixed(2)}s`)
    await sleep(300)
  }
  writeMedia("call.wav", makeWav(Buffer.concat(parts), RATE))
  writeFileSync(mediaPath("call.json"), JSON.stringify({ sampleRate: RATE, totalSeconds: Number(cursor.toFixed(2)), turns }, null, 2) + "\n")
  console.log(`total ${cursor.toFixed(2)}s`)
}
