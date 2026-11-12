// Follow-ups raised by experiment 10.
//   1  wording for a behaviour that shows in only some frames of a turn
//   2  do image tokens depend on pixel size, or only on the resolution setting?
//   3  a turn as one video block built from the same frames: tokens, answers, time addressing
//   4  is WebM (what a browser MediaRecorder produces) accepted as a video block?
// Needs ffmpeg.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decide, imageBlock, mediaPath, saveResult, sleep, tokensByModality, VISUAL_PRESENCE } from "./lib.mjs"

const work = mkdtempSync(join(tmpdir(), "followups-"))
const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args])
const output = { ranAt: new Date().toISOString(), model: "gemini-decision-1" }
const TURN = ["attentive", "attentive", "away_screen", "away_screen", "attentive", "engaged"]
const LEAD = "Look at the attached video frames of the EMPLOYEE, taken about a second apart during one turn of the call."

// 1. Wording for partial behaviours.
const wordings = {
  project: `${LEAD} Is this statement true of what is visible in the frames? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
  any_frame: `${LEAD} Is this statement true of at least one of the frames? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
  most_frames: `${LEAD} Is this statement true of most of the frames? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
  every_frame: `${LEAD} Is this statement true of every one of the frames? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
}
const sets = {
  "2 of 6 away": TURN,
  "0 of 6 away": ["attentive", "attentive", "engaged", "attentive", "flat", "engaged"],
  "5 of 6 away": ["away_screen", "down_phone", "away_screen", "attentive", "down_phone", "away_screen"],
  "6 of 6 away": ["away_screen", "down_phone", "away_screen", "slumped", "down_phone", "away_screen"],
}
output.wording = []
console.log("1. P(looks away) by wording")
for (const [label, frames] of Object.entries(sets)) {
  const result = await decide(
    frames.map((state) => imageBlock(`frame_${state}.jpg`, "low")),
    Object.fromEntries(Object.entries(wordings).map(([key, instructions]) => [key, { type: "noul", instructions }])),
  )
  output.wording.push({ label, frames, answers: result.answers })
  console.log(`${label.padEnd(12)} ${Object.keys(wordings).map((key) => `${key}=${result.answers[key].noul.toFixed(2)}`).join("  ")}`)
  await sleep(120)
}

// 2. Pixel size versus tokens.
output.pixelSize = []
console.log("\n2. image tokens by pixel size and setting")
const one = { away: { type: "noul", instructions: `Look at the attached video frame of the EMPLOYEE. Is this statement true of the frame? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` } }
for (const [width, height] of [[160, 90], [320, 180], [640, 360], [1280, 720], [1920, 1080]]) {
  const target = join(work, `size-${width}.jpg`)
  ffmpeg(["-i", mediaPath("frame_down_phone.jpg"), "-vf", `scale=${width}:${height}`, "-q:v", "5", target])
  const data = readFileSync(target).toString("base64")
  const row = { width, height, bytes: readFileSync(target).length }
  for (const resolution of ["low", "medium", "high"]) {
    const result = await decide([{ type: "image", data, mime_type: "image/jpeg", resolution }], one)
    row[resolution] = { tokens: tokensByModality(result.usage).image, away: result.answers.away.noul, ms: result.ms }
    await sleep(100)
  }
  output.pixelSize.push(row)
  console.log(
    `${`${width}x${height}`.padEnd(10)} ${String(row.bytes).padStart(7)}B ` +
      ["low", "medium", "high"].map((r) => `${r}: ${row[r].tokens} tok P=${row[r].away.toFixed(2)} ${row[r].ms}ms`).join(" | "),
  )
}

// 3. The six-second turn as one video block (1 frame per second, no sound).
const list = join(work, "frames.txt")
const { writeFileSync } = await import("node:fs")
writeFileSync(list, TURN.map((state) => `file '${mediaPath(`frame_${state}.jpg`)}'\nduration 1`).join("\n") + `\nfile '${mediaPath(`frame_${TURN.at(-1)}.jpg`)}'\n`)
const mp4 = join(work, "turn.mp4")
ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=10,format=yuv420p", "-c:v", "libx264", "-crf", "26", mp4])
const webm = join(work, "turn.webm")
ffmpeg(["-i", mp4, "-c:v", "libvpx-vp9", "-b:v", "200k", webm])
const videoQuestions = {
  presence: {
    type: "score",
    instructions: `Watch the attached video of the EMPLOYEE during one turn of the call. Rate "${VISUAL_PRESENCE.name}": ${VISUAL_PRESENCE.description} Judge only what is visible. Choose the level whose description fits best.`,
    criteria: VISUAL_PRESENCE.levels,
  },
  away_project: { type: "noul", instructions: `Watch the attached video of the EMPLOYEE during one turn of the call. Is this statement true of what is visible? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` },
  away_any: { type: "noul", instructions: `Watch the attached video of the EMPLOYEE during one turn of the call. Is this statement true at any point in the video? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` },
  away_0_2: { type: "noul", instructions: `Watch the attached video of the EMPLOYEE. Focus only on the first two seconds (0:00 to 0:02). Is this statement true of that part? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` },
  away_2_4: { type: "noul", instructions: `Watch the attached video of the EMPLOYEE. Focus only on the part from 0:02 to 0:04. Is this statement true of that part? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` },
  away_4_6: { type: "noul", instructions: `Watch the attached video of the EMPLOYEE. Focus only on the last two seconds (0:04 to 0:06). Is this statement true of that part? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}` },
}
output.videoTurn = []
console.log("\n3 and 4. the six-second turn as a video block")
for (const [label, path, mimeType, resolution] of [
  ["mp4 low", mp4, "video/mp4", "low"],
  ["mp4 medium", mp4, "video/mp4", "medium"],
  ["mp4 high", mp4, "video/mp4", "high"],
  ["mp4 unspecified", mp4, "video/mp4", undefined],
  ["webm (VP9) low", webm, "video/webm", "low"],
]) {
  const bytes = readFileSync(path)
  const result = await decide(
    [{ type: "video", data: bytes.toString("base64"), mime_type: mimeType, ...(resolution ? { resolution } : {}) }],
    videoQuestions,
  )
  const tokens = tokensByModality(result.usage)
  output.videoTurn.push({ label, bytes: bytes.length, status: result.status, ms: result.ms, tokens, answers: result.answers, error: result.error })
  console.log(
    `${label.padEnd(16)} ${String(bytes.length).padStart(6)}B HTTP ${result.status} ` +
      (result.ok
        ? `${JSON.stringify(tokens)} ${result.ms}ms presence=${result.answers.presence.score.toFixed(2)} away=${result.answers.away_project.noul.toFixed(2)} any=${result.answers.away_any.noul.toFixed(2)} 0-2s=${result.answers.away_0_2.noul.toFixed(2)} 2-4s=${result.answers.away_2_4.noul.toFixed(2)} 4-6s=${result.answers.away_4_6.noul.toFixed(2)}`
        : JSON.stringify(result.error).slice(0, 200)),
  )
  await sleep(150)
}

saveResult("11-followups", output)
