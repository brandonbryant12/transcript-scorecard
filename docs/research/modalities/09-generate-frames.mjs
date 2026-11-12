// Generate SYNTHETIC webcam-style frames of one fictional support agent in six states.
// The first image is generated from text; the others are edits of it, so the person, room
// and framing stay the same and only the behaviour changes. Frames are downscaled to
// 640x360 JPEG, roughly what a webcam sampled once a second would give. Needs ffmpeg.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hasMedia, mediaPath, sleep, writeMedia } from "./lib.mjs"

const KEY = process.env.GEMINI_API_KEY
const IMAGE_MODEL = "gemini-nano-banana-2.1"

const BASE_PROMPT =
  "A realistic webcam frame from a video call, 16:9. A fictional customer support agent in their thirties wearing a headset " +
  "sits at a desk in a plain home office, shown from the chest up, well lit from the front. They are facing the camera and " +
  "looking straight into it with a calm, attentive, neutral-pleasant expression. Ordinary webcam quality, no text, no logos."

export const STATES = [
  { id: "attentive", edit: null, note: "facing camera, steady attention" },
  { id: "engaged", edit: "The same person, same room and framing, now smiling warmly and nodding slightly while still looking straight into the camera.", note: "smiling and nodding at camera" },
  { id: "flat", edit: "The same person, same room and framing, still facing the camera, but with a completely flat, blank, unreadable expression.", note: "facing camera, blank expression" },
  { id: "away_screen", edit: "The same person, same room and framing, now with their head turned well to one side, reading a second monitor off to the side. They are not looking at the camera.", note: "head turned to a second screen" },
  { id: "down_phone", edit: "The same person, same room and framing, now looking down at a phone held in their hand below the desk edge, eyes cast down, not looking at the camera.", note: "looking down at a phone" },
  { id: "slumped", edit: "The same person, same room and framing, now slumped back in the chair with their head resting on one hand, eyes half closed, looking bored and disengaged.", note: "slumped, head on hand, bored" },
]

const generate = async (input) => {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      input,
      response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "16:9", image_size: "1K" },
    }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`Image generation failed (HTTP ${response.status}): ${JSON.stringify(json).slice(0, 400)}`)
  const image = (json.steps ?? [])
    .flatMap((step) => step.content ?? [])
    .filter((block) => block.type === "image")
    .at(-1)
  const data = image?.data ?? json.output_image?.data
  if (!data) throw new Error(`No image returned: ${JSON.stringify(json).slice(0, 400)}`)
  return Buffer.from(data, "base64")
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const work = mkdtempSync(join(tmpdir(), "frames-"))
  const downscale = (bytes, name) => {
    const source = join(work, `${name}-full.jpg`)
    writeFileSync(source, bytes)
    const target = join(work, `${name}.jpg`)
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", "scale=640:360", "-q:v", "5", target])
    return readFileSync(target)
  }
  let base = null
  for (const state of STATES) {
    const file = `frame_${state.id}.jpg`
    if (hasMedia(file)) {
      console.log(`${file} exists`)
      continue
    }
    if (state.edit === null) {
      base = await generate([{ type: "text", text: BASE_PROMPT }])
      writeFileSync(join(work, "base-full.jpg"), base)
      writeMedia(file, downscale(base, state.id))
    } else {
      base ??= readFileSync(join(work, "base-full.jpg"))
      const edited = await generate([
        { type: "text", text: `${state.edit} Keep everything else identical. Realistic webcam frame, no text.` },
        { type: "image", data: base.toString("base64"), mime_type: "image/jpeg" },
      ])
      writeMedia(file, downscale(edited, state.id))
    }
    console.log(`${file} ${readFileSync(mediaPath(file)).length} bytes`)
    await sleep(500)
  }
}
