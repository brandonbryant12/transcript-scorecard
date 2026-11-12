// Experiment 1: does the voice carry signal the words do not?
// Each clip is judged three ways (text only, audio only, text + audio), three times each.
import { CLIPS } from "./01-generate-speech.mjs"
import {
  audioBlock,
  brief,
  decide,
  saveResult,
  SENTIMENT_LEVELS,
  sleep,
  textBlock,
  tokensByModality,
  VOCAL_DELIVERY,
} from "./lib.mjs"

const REPEATS = 3

const EMOTIONS = {
  anxious: "Worried about consequences, under time pressure, or uneasy about a risk.",
  cooperative: "Engaged and working the problem with the employee, without notable distress.",
  frustrated: "Annoyed or exasperated with the employee, the company, or having to repeat themselves.",
  neutral: "Matter-of-fact; no clear emotional colour.",
  reassured: "Relieved, calmer, appreciative, or confident the issue is in good hands.",
  skeptical: "Doubting what they have been told, or pressing for proof or a commitment.",
}

// Customer clips: the sentiment rubric, worded three ways so we can see what wording does.
const customerQuestions = (condition) => ({
  ...(condition === "text"
    ? {
        sentiment_plain: {
          type: "score",
          instructions: "How does the CUSTOMER feel in this turn?",
          criteria: SENTIMENT_LEVELS,
        },
      }
    : {
        // Wording used by the project's media lane.
        sentiment_voice: {
          type: "score",
          instructions:
            "Listen to the attached audio clip of the CUSTOMER. Judging by the sound of their voice (tone, pace and emphasis) rather than the words, how does the customer feel?",
          criteria: SENTIMENT_LEVELS,
        },
        // No steer towards voice or words.
        sentiment_plain: {
          type: "score",
          instructions: "Listen to the attached audio clip of the CUSTOMER. How does the customer feel?",
          criteria: SENTIMENT_LEVELS,
        },
      }),
  emotion: {
    type: "choice",
    instructions:
      condition === "text"
        ? "Which emotion best describes the CUSTOMER in this turn?"
        : "Listen to the attached audio clip of the CUSTOMER. Which emotion best describes the customer?",
    criteria: EMOTIONS,
  },
})

const employeeQuestions = (condition) => {
  const lead =
    condition === "text"
      ? "Read the EMPLOYEE's turn."
      : "Listen to the attached audio clip of the EMPLOYEE."
  const judge =
    condition === "text"
      ? "Judge how the employee comes across."
      : "Judge only how the employee sounds in this clip, not the words they chose."
  return {
    delivery: {
      type: "score",
      instructions: `${lead} Rate "${VOCAL_DELIVERY.name}": ${VOCAL_DELIVERY.description} ${judge} Choose the level whose description fits best.`,
      criteria: VOCAL_DELIVERY.levels,
    },
    calm_pace: {
      type: "noul",
      instructions: `${lead} Is this statement true of ${condition === "text" ? "the turn" : "how they sound in the clip"}? Statement: ${VOCAL_DELIVERY.behaviors.calm_pace}`,
    },
    irritated_tone: {
      type: "noul",
      instructions: `${lead} Is this statement true of ${condition === "text" ? "the turn" : "how they sound in the clip"}? Statement: ${VOCAL_DELIVERY.behaviors.irritated_tone}`,
    },
  }
}

const inputFor = (clip, condition) => {
  const line = `${clip.speaker === "customer" ? "CUSTOMER" : "EMPLOYEE"}: ${clip.text}`
  if (condition === "text") return line
  if (condition === "audio") return [audioBlock(`${clip.id}.wav`)]
  return [textBlock(`Transcript of the attached clip:\n${line}\n`), audioBlock(`${clip.id}.wav`)]
}

const runs = []
for (const clip of CLIPS) {
  for (const condition of ["text", "audio", "text+audio"]) {
    const questions = clip.speaker === "customer" ? customerQuestions(condition) : employeeQuestions(condition)
    for (let repeat = 1; repeat <= REPEATS; repeat++) {
      const result = await decide(inputFor(clip, condition), questions)
      runs.push({
        clip: clip.id,
        set: clip.set,
        text: clip.text,
        style: clip.style,
        condition,
        repeat,
        ok: result.ok,
        ms: result.ms,
        tokens: tokensByModality(result.usage),
        answers: result.answers,
        error: result.error,
      })
      if (!result.ok) console.log(`${clip.id} ${condition} FAILED`, JSON.stringify(result.error))
      else if (repeat === 1) {
        console.log(
          `${clip.id.padEnd(32)} ${condition.padEnd(10)} ${String(result.ms).padStart(5)}ms ${JSON.stringify(tokensByModality(result.usage))} ` +
            Object.entries(result.answers)
              .map(([key, answer]) => `${key}=${brief(answer)}`)
              .join("  "),
        )
      }
      await sleep(150)
    }
  }
}

saveResult("02-voice-vs-words", {
  ranAt: new Date().toISOString(),
  model: "gemini-decision-1",
  repeats: REPEATS,
  questions: {
    customer: { text: customerQuestions("text"), audio: customerQuestions("audio") },
    employee: { text: employeeQuestions("text"), audio: employeeQuestions("audio") },
  },
  runs,
})
