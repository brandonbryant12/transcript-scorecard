// Stimulus check: does each synthetic clip actually sound the way it was asked to?
// A general model (not the decision model) describes the voice without being told the style.
import { CLIPS } from "./01-generate-speech.mjs"
import { audioBlock, describe, GENERAL_MODEL, saveResult, sleep, textBlock } from "./lib.mjs"

const PROMPT =
  "Listen to this short clip of one person speaking. Ignore what the words mean. " +
  "Line 1: describe the speaker's tone of voice and pace in at most ten words. " +
  "Line 2: one label for the emotion you hear in the voice, chosen from: " +
  "warm, flat, irritated, anxious, relieved, sarcastic, cheerful, panicked, rushed, neutral. " +
  "Line 3: a number from 0 (very negative) to 4 (very positive) for how the speaker feels, judged by voice only."

const rows = []
for (const clip of CLIPS) {
  const result = await describe([textBlock(PROMPT), audioBlock(`${clip.id}.wav`)])
  rows.push({ clip: clip.id, requestedStyle: clip.style, text: clip.text, heard: result.text, ok: result.ok })
  console.log(`${clip.id.padEnd(32)} asked: ${clip.style}\n    heard: ${result.text.replace(/\n+/g, " | ")}`)
  await sleep(200)
}
saveResult("03-stimulus-check", { ranAt: new Date().toISOString(), model: GENERAL_MODEL, prompt: PROMPT, rows })
