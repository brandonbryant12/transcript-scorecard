// Experiments 4 and 5: what frames and video carry.
//   A  single synthetic frames at each resolution setting (tokens, rubric, behaviours)
//   B  how many frames per turn: 1, 3 or 6 from a turn where the agent looks away part-way
//   C  real faces: frames taken from RAVDESS video clips (RAVDESS_DIR, optional)
//   D  a `video` block versus separate frames + audio (RAVDESS_DIR, optional)
//   E  conflicts between channels: warm voice with a distracted picture, and the reverse
// Needs ffmpeg for C and D.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  audioBlock,
  audioBlockFrom,
  decide,
  imageBlock,
  saveResult,
  SENTIMENT_LEVELS,
  sleep,
  textBlock,
  tokensByModality,
  toMicWav,
  VISUAL_PRESENCE,
  VOCAL_DELIVERY,
} from "./lib.mjs"

const FRAME_LEAD = "Look at the attached video frames of the EMPLOYEE, taken about a second apart during one turn of the call."
const visualQuestions = (lead = FRAME_LEAD) => ({
  presence: {
    type: "score",
    instructions: `${lead} Rate "${VISUAL_PRESENCE.name}": ${VISUAL_PRESENCE.description} Judge only what is visible in the frames. Choose the level whose description fits best.`,
    criteria: VISUAL_PRESENCE.levels,
  },
  faces_camera: {
    type: "noul",
    instructions: `${lead} Is this statement true of what is visible in the frames? Statement: ${VISUAL_PRESENCE.behaviors.faces_camera}`,
  },
  looks_away: {
    type: "noul",
    instructions: `${lead} Is this statement true of what is visible in the frames? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
  },
})
const vocalQuestions = {
  delivery: {
    type: "score",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Rate "${VOCAL_DELIVERY.name}": ${VOCAL_DELIVERY.description} Judge only how the employee sounds in this clip, not the words they chose. Choose the level whose description fits best.`,
    criteria: VOCAL_DELIVERY.levels,
  },
  irritated_tone: {
    type: "noul",
    instructions: `Listen to the attached audio clip of the EMPLOYEE. Is this statement true of how they sound in the clip? Statement: ${VOCAL_DELIVERY.behaviors.irritated_tone}`,
  },
}
const dist = (answer) => Object.values(answer.probabilities).map((p) => p.toFixed(2)).join(" ")
const output = { ranAt: new Date().toISOString(), model: "gemini-decision-1" }

// --- A: single frames at each resolution --------------------------------------
const STATES = ["attentive", "engaged", "flat", "away_screen", "down_phone", "slumped"]
const RESOLUTIONS = [undefined, "low", "medium", "high", "ultra_high"]
output.singleFrames = []
console.log("A. single frame: presence score [distribution] faces / away, image tokens")
for (const state of STATES) {
  for (const resolution of RESOLUTIONS) {
    const result = await decide(
      [imageBlock(`frame_${state}.jpg`, resolution)],
      visualQuestions("Look at the attached video frame of the EMPLOYEE, taken during one turn of the call."),
    )
    const tokens = tokensByModality(result.usage)
    output.singleFrames.push({ state, resolution: resolution ?? "unspecified", status: result.status, ms: result.ms, tokens, answers: result.answers, error: result.error })
    if (result.ok) {
      console.log(
        `${state.padEnd(12)} ${(resolution ?? "unspecified").padEnd(11)} image=${String(tokens.image).padStart(5)} ${String(result.ms).padStart(4)}ms presence=${result.answers.presence.score.toFixed(2)} [${dist(result.answers.presence)}] faces=${result.answers.faces_camera.noul.toFixed(2)} away=${result.answers.looks_away.noul.toFixed(2)}`,
      )
    } else console.log(`${state} ${resolution} HTTP ${result.status} ${JSON.stringify(result.error).slice(0, 160)}`)
    await sleep(120)
  }
}

// --- B: frames per turn ---------------------------------------------------------
// One turn, six seconds: attentive, attentive, looks at the other screen for two seconds,
// back to the camera, then smiling.
const TURN = ["attentive", "attentive", "away_screen", "away_screen", "attentive", "engaged"]
const samplings = {
  "1 frame (first)": [0],
  "1 frame (middle)": [2],
  "3 frames (0,2,4)": [0, 2, 4],
  "3 frames (1,3,5)": [1, 3, 5],
  "6 frames": [0, 1, 2, 3, 4, 5],
}
output.framesPerTurn = []
console.log("\nB. frames per turn (low resolution)")
for (const [label, indexes] of Object.entries(samplings)) {
  const result = await decide(indexes.map((index) => imageBlock(`frame_${TURN[index]}.jpg`, "low")), visualQuestions())
  const tokens = tokensByModality(result.usage)
  output.framesPerTurn.push({ label, frames: indexes.map((index) => TURN[index]), ms: result.ms, tokens, answers: result.answers })
  console.log(
    `${label.padEnd(18)} image=${String(tokens.image).padStart(5)} ${String(result.ms).padStart(4)}ms presence=${result.answers.presence.score.toFixed(2)} [${dist(result.answers.presence)}] faces=${result.answers.faces_camera.noul.toFixed(2)} away=${result.answers.looks_away.noul.toFixed(2)}`,
  )
  await sleep(120)
}
// The same six frames in one request, asked frame by frame, to see whether a single frame
// inside a set can be addressed.
{
  const blocks = []
  TURN.forEach((state, index) => blocks.push(textBlock(`\nFrame ${index + 1}:\n`), imageBlock(`frame_${state}.jpg`, "low")))
  const questions = {}
  TURN.forEach((_, index) => {
    questions[`f${index}_away`] = {
      type: "noul",
      instructions: `Six video frames of the EMPLOYEE are attached, each introduced by a label. Look only at the frame labelled "Frame ${index + 1}". Is this statement true of that frame? Statement: ${VISUAL_PRESENCE.behaviors.looks_away}`,
    }
  })
  const result = await decide(blocks, questions)
  output.frameAddressing = { frames: TURN, answers: result.answers, tokens: tokensByModality(result.usage) }
  console.log(`per-frame P(looks away) by label: ${TURN.map((state, index) => `${state}=${result.answers[`f${index}_away`].noul.toFixed(2)}`).join("  ")}`)
}

// --- E: channel conflicts (synthetic voice and frames) -------------------------
output.conflicts = []
console.log("\nE. channel conflicts: one request carrying both a clip and a frame")
const conflictCases = [
  { id: "warm voice + looking at phone", audio: "c_warm_calm.wav", frame: "down_phone" },
  { id: "warm voice + engaged", audio: "c_warm_calm.wav", frame: "engaged" },
  { id: "rushed voice + engaged", audio: "c_rushed.wav", frame: "engaged" },
]
for (const item of conflictCases) {
  const both = { ...Object.fromEntries(Object.entries(vocalQuestions).map(([k, v]) => [`vocal_${k}`, v])), ...Object.fromEntries(Object.entries(visualQuestions("Look at the attached video frame of the EMPLOYEE, taken during one turn of the call.")).map(([k, v]) => [`visual_${k}`, v])) }
  const together = await decide([audioBlock(item.audio), imageBlock(`frame_${item.frame}.jpg`, "low")], both)
  const audioOnly = await decide([audioBlock(item.audio)], vocalQuestions)
  const frameOnly = await decide([imageBlock(`frame_${item.frame}.jpg`, "low")], visualQuestions("Look at the attached video frame of the EMPLOYEE, taken during one turn of the call."))
  const row = {
    id: item.id,
    together: { tokens: tokensByModality(together.usage), ms: together.ms, answers: together.answers },
    audioOnly: audioOnly.answers,
    frameOnly: frameOnly.answers,
  }
  output.conflicts.push(row)
  console.log(
    `${item.id.padEnd(30)} together: delivery=${together.answers.vocal_delivery.score.toFixed(2)} irr=${together.answers.vocal_irritated_tone.noul.toFixed(2)} presence=${together.answers.visual_presence.score.toFixed(2)} away=${together.answers.visual_looks_away.noul.toFixed(2)} | separate: delivery=${audioOnly.answers.delivery.score.toFixed(2)} irr=${audioOnly.answers.irritated_tone.noul.toFixed(2)} presence=${frameOnly.answers.presence.score.toFixed(2)} away=${frameOnly.answers.looks_away.noul.toFixed(2)}`,
  )
  await sleep(120)
}

// --- C and D: real faces and video blocks (RAVDESS) ---------------------------
const DIR = process.env.RAVDESS_DIR
if (DIR && existsSync(DIR)) {
  const work = mkdtempSync(join(tmpdir(), "video-"))
  const ffmpeg = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args])
  const FACE = {
    angry: "Angry or hostile.",
    happy: "Happy or cheerful.",
    neutral: "Neutral, no particular feeling.",
    sad: "Sad or dejected.",
  }
  const faceQuestion = (lead) => ({
    type: "choice",
    instructions: `${lead} Judging only by the face, which emotion is the person showing?`,
    criteria: FACE,
  })
  const voiceQuestion = (lead) => ({
    type: "choice",
    instructions: `${lead} Judging only by the sound of the voice, which emotion is the speaker expressing?`,
    criteria: FACE,
  })
  const clips = [["neutral", "01-01"], ["happy", "03-02"], ["sad", "04-02"], ["angry", "05-02"]]
  output.realFaces = []
  output.videoBlocks = []
  console.log("\nC. real faces: three frames per clip, low resolution")
  for (const [emotion, code] of clips) {
    const mp4 = join(DIR, `01-01-${code}-01-01-01.mp4`)
    const frames = [1.0, 1.8, 2.6].map((at, index) => {
      const target = join(work, `${emotion}-${index}.jpg`)
      ffmpeg(["-ss", String(at), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:360", "-q:v", "5", target])
      return { type: "image", data: readFileSync(target).toString("base64"), mime_type: "image/jpeg", resolution: "low" }
    })
    const wavPath = join(work, `${emotion}.wav`)
    ffmpeg(["-i", mp4, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath])
    const wav = toMicWav(readFileSync(wavPath))

    const framesOnly = await decide(frames, { face: faceQuestion("Look at the attached video frames of one person."), ...visualQuestions() })
    output.realFaces.push({ emotion, tokens: tokensByModality(framesOnly.usage), ms: framesOnly.ms, answers: framesOnly.answers })
    console.log(
      `${emotion.padEnd(8)} face=${framesOnly.answers.face.choice}(${framesOnly.answers.face.confidence.toFixed(2)}) presence=${framesOnly.answers.presence.score.toFixed(2)} [${dist(framesOnly.answers.presence)}] faces=${framesOnly.answers.faces_camera.noul.toFixed(2)} image=${tokensByModality(framesOnly.usage).image}`,
    )

    // D: the same moment as one video block, with and without its sound track.
    const small = join(work, `${emotion}-small.mp4`)
    ffmpeg(["-i", mp4, "-vf", "scale=640:360", "-c:v", "libx264", "-crf", "28", "-c:a", "aac", "-b:a", "48k", small])
    const mute = join(work, `${emotion}-mute.mp4`)
    ffmpeg(["-i", small, "-an", "-c:v", "copy", mute])
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", small]).toString())
    const duration = Number(Number(probe.format.duration).toFixed(2))
    const videoQuestions = {
      face: faceQuestion("Watch the attached video of one person."),
      voice: voiceQuestion("Watch the attached video of one person."),
      heard: { type: "noul", instructions: 'Watch the attached video. Does the person say the words "kids are talking by the door"?' },
      presence: visualQuestions("Watch the attached video of the EMPLOYEE during one turn of the call.").presence,
    }
    const variants = [
      ["video original 720p, low", { type: "video", data: readFileSync(mp4).toString("base64"), mime_type: "video/mp4", resolution: "low" }],
      ["video 360p, low", { type: "video", data: readFileSync(small).toString("base64"), mime_type: "video/mp4", resolution: "low" }],
      ["video 360p, high", { type: "video", data: readFileSync(small).toString("base64"), mime_type: "video/mp4", resolution: "high" }],
      ["video 360p, no sound, low", { type: "video", data: readFileSync(mute).toString("base64"), mime_type: "video/mp4", resolution: "low" }],
    ]
    for (const [label, block] of variants) {
      const result = await decide([block], videoQuestions)
      const tokens = tokensByModality(result.usage)
      output.videoBlocks.push({ emotion, label, seconds: duration, bytes: Math.round((block.data.length * 3) / 4), status: result.status, ms: result.ms, tokens, answers: result.answers, error: result.error })
      console.log(
        `   ${label.padEnd(28)} ${duration}s HTTP ${result.status} ` +
          (result.ok
            ? `${JSON.stringify(tokens)} ${result.ms}ms face=${result.answers.face.choice}(${result.answers.face.confidence.toFixed(2)}) voice=${result.answers.voice.choice}(${result.answers.voice.confidence.toFixed(2)}) heard=${result.answers.heard.noul.toFixed(2)} presence=${result.answers.presence.score.toFixed(2)}`
            : JSON.stringify(result.error).slice(0, 200)),
      )
      await sleep(150)
    }
    const separate = await decide([...frames, audioBlockFrom(wav)], videoQuestions)
    output.videoBlocks.push({ emotion, label: "3 frames + audio clip", seconds: duration, ms: separate.ms, tokens: tokensByModality(separate.usage), answers: separate.answers })
    console.log(
      `   ${"3 frames + audio clip".padEnd(28)} ${JSON.stringify(tokensByModality(separate.usage))} ${separate.ms}ms face=${separate.answers.face.choice}(${separate.answers.face.confidence.toFixed(2)}) voice=${separate.answers.voice.choice}(${separate.answers.voice.confidence.toFixed(2)}) heard=${separate.answers.heard.noul.toFixed(2)} presence=${separate.answers.presence.score.toFixed(2)}`,
    )

    // A fused "how do they come across" question, to see which channel wins when asked plainly.
    if (emotion === "angry" || emotion === "happy") {
      const overall = {
        overall: { type: "score", instructions: "How does this person feel? Use everything available.", criteria: SENTIMENT_LEVELS },
      }
      const sentence = textBlock('Transcript: "Kids are talking by the door."\n')
      const fused = {
        text: (await decide('Transcript: "Kids are talking by the door."', overall)).answers.overall.score,
        textAudio: (await decide([sentence, audioBlockFrom(wav)], overall)).answers.overall.score,
        textFrames: (await decide([sentence, ...frames], overall)).answers.overall.score,
        all: (await decide([sentence, audioBlockFrom(wav), ...frames], overall)).answers.overall.score,
        audioOnly: (await decide([audioBlockFrom(wav)], overall)).answers.overall.score,
        framesOnly: (await decide(frames, overall)).answers.overall.score,
      }
      output.fused = { ...(output.fused ?? {}), [emotion]: fused }
      console.log(`   fused sentiment (${emotion}): ${Object.entries(fused).map(([k, v]) => `${k}=${v.toFixed(2)}`).join("  ")}`)
    }
  }
}

saveResult("10-frames-and-video", output)
