// A voice practice call with no microphone.
//
// This plays the browser's part of a practice call from the command line. It speaks a
// short script of employee lines using the operating system's text-to-speech, streams
// that audio to the practice WebSocket exactly as a browser would, lets the real-time
// voice model answer as the customer, and prints how the call was scored.
//
// It exercises the whole audio path: microphone audio -> real-time voice model ->
// transcribed turns -> per-turn audio clips -> scoring. Pass --frames with image files to
// send camera frames too (one file per employee line), which adds the video path.
//
//   pnpm --filter @scorecard/api practice-demo
//   pnpm --filter @scorecard/api practice-demo -- --provider gemini --scenario hub-offline
//   pnpm --filter @scorecard/api practice-demo -- --frames a.jpg,b.jpg,c.jpg
//
// Requires macOS (`say` and `afconvert`), a running API, and GEMINI_API_KEY configured on
// the API server. The call is real: it uses the voice model and the scoring provider.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

const { values: options } = parseArgs({
  // pnpm passes a literal "--" through to the script; it is not an argument.
  args: process.argv.slice(2).filter((argument) => argument !== '--'),
  options: {
    api: { type: 'string', default: process.env.SCORECARD_API ?? 'http://127.0.0.1:3001' },
    provider: { type: 'string', default: 'gemini' },
    scenario: { type: 'string', default: 'double-charge' },
    frames: { type: 'string', default: '' },
  },
});

// What the employee says. The customer is improvised by the voice model, so these lines
// are written to make sense whatever the customer answers.
const EMPLOYEE_LINES = [
  'Acme Support, this is Riley. How can I help you today?',
  "I'm really sorry about that. I understand why that is frustrating, and I will take ownership of fixing it. Before I open your account, can you confirm the security details we have on file?",
  'Thank you, that matches. I have looked into it and taken care of it now. You will get an email confirmation with a reference number in the next few minutes. Is there anything else I can help with?',
];

const MIC_RATE = 16_000;
const CHUNK_BYTES = (MIC_RATE / 10) * 2; // 100 ms of 16-bit mono
// How long the customer must be quiet before the employee speaks again.
const REPLY_GAP_MS = 2_500;
const NO_REPLY_MS = 15_000;

// Text to 16 kHz, 16-bit mono PCM, the format the practice socket expects.
function synthesize(text, directory, index) {
  const aiff = join(directory, `line-${index}.aiff`);
  const wav = join(directory, `line-${index}.wav`);
  execFileSync('say', ['-o', aiff, text]);
  execFileSync('afconvert', ['-f', 'WAVE', '-d', `LEI16@${MIC_RATE}`, '-c', '1', aiff, wav]);
  const file = readFileSync(wav);
  // Skip the WAV header: the audio starts after the "data" chunk's 8-byte preamble.
  return file.subarray(file.indexOf('data') + 8);
}

const workDirectory = mkdtempSync(join(tmpdir(), 'practice-demo-'));
const lines = EMPLOYEE_LINES.map((text, index) => synthesize(text, workDirectory, index));
rmSync(workDirectory, { recursive: true, force: true });
const frames = options.frames
  .split(',')
  .filter(Boolean)
  .map((file) => readFileSync(file).toString('base64'));

const socket = new WebSocket(`${options.api.replace(/^http/, 'ws')}/api/practice`);
const send = (event, data) => socket.send(JSON.stringify({ event, data }));
const silence = Buffer.alloc(CHUNK_BYTES).toString('base64');

let sessionId = null;
let speaking = null; // { pcm, offset } while a line is being spoken
let nextLine = 0;
let tick = 0;
let lineEndedAt = 0;
let lastCustomerAudioAt = 0;
let ending = false;

socket.on('open', () => {
  send('start', {
    scenarioId: options.scenario,
    agentName: 'Riley Chen',
    provider: options.provider,
    video: frames.length > 0,
  });
});

socket.on('message', (raw) => {
  const { event, data } = JSON.parse(raw.toString());
  if (event === 'ready') {
    sessionId = data.sessionId;
    console.log(`Practice call started: session ${sessionId}`);
    speakNextLine();
    setInterval(streamMicrophone, 100);
  } else if (event === 'audio') {
    lastCustomerAudioAt = Date.now();
  } else if (event === 'error') {
    console.error(`Error: ${data.message}`);
    process.exit(1);
  } else if (event === 'ended') {
    void report().finally(() => process.exit(0));
  }
});

socket.on('error', (cause) => {
  console.error(`Could not reach the practice socket: ${cause.message}`);
  process.exit(1);
});

function speakNextLine() {
  console.log(`Employee says: ${EMPLOYEE_LINES[nextLine]}`);
  speaking = { pcm: lines[nextLine], offset: 0 };
  nextLine += 1;
}

// A microphone never stops: between lines it sends silence, which is also what lets the
// voice model notice that the employee has finished speaking.
function streamMicrophone() {
  if (ending) return;
  if (speaking) {
    // One camera frame a second while speaking; frame N belongs to line N.
    if (frames.length > 0 && tick++ % 10 === 0) {
      send('frame', frames[Math.min(nextLine - 1, frames.length - 1)]);
    }
    send(
      'audio',
      speaking.pcm.subarray(speaking.offset, speaking.offset + CHUNK_BYTES).toString('base64'),
    );
    speaking.offset += CHUNK_BYTES;
    if (speaking.offset >= speaking.pcm.length) {
      speaking = null;
      lineEndedAt = Date.now();
      lastCustomerAudioAt = 0;
    }
    return;
  }
  send('audio', silence);
  const customerReplied =
    lastCustomerAudioAt > lineEndedAt && Date.now() - lastCustomerAudioAt > REPLY_GAP_MS;
  const customerSilent = Date.now() - lineEndedAt > NO_REPLY_MS;
  if (!customerReplied && !customerSilent) return;
  if (nextLine < lines.length) {
    speakNextLine();
  } else {
    ending = true;
    send('end', null);
  }
}

// The call has ended, but its final scoring pass may still be running.
async function finishedSession() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch(`${options.api}/api/live/${sessionId}`);
    const session = await response.json();
    if (session.status === 'completed' || session.status === 'failed') return session;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('The final evaluation did not arrive within 30 seconds');
}

async function report() {
  const session = await finishedSession();
  const evaluation = session.evaluation;
  console.log('\nTranscript');
  for (const turn of session.transcript) console.log(`  ${turn.speaker.padEnd(8)} ${turn.text}`);
  if (!evaluation) return console.log(`\nNo evaluation (${session.error ?? session.status}).`);

  console.log(
    `\n${evaluation.stage} score ${evaluation.overallScore} from ${evaluation.channels.join(' + ')}` +
      ` (coverage ${Math.round(evaluation.coverage * 100)}%)`,
  );
  console.log(evaluation.coaching.headline);
  for (const skill of evaluation.skills) {
    const result = skill.assessed
      ? `${String(skill.normalizedScore).padStart(5)}  ${skill.levels[skill.level].label}`
      : `    -  not assessed (needs ${skill.channel === 'vocal' ? 'audio' : 'video'})`;
    console.log(`  ${skill.name.padEnd(28)} ${result}`);
  }
  for (const point of evaluation.journey?.points ?? []) {
    const voice = point.voiceSentiment === null ? 'n/a' : point.voiceSentiment;
    console.log(
      `  customer ${point.turnId}: ${point.emotion}; sentiment from words ${point.textSentiment}, from voice ${voice}`,
    );
  }
  const { totals } = session;
  console.log(
    `\n${totals.requests} scoring requests, ${totals.questions} questions, ${totals.inputTokens} input tokens,` +
      ` about $${totals.estimatedCostUsd.toFixed(4)}`,
  );
}
