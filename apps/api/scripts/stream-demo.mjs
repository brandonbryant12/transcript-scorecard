#!/usr/bin/env node
// Stream demo: how any real-time source feeds live scoring.
//
// A "stream" is a live session for a call that does not exist yet. Whatever produces the
// turns (a speech-to-text service, a contact-centre platform, a voice model, or this
// script) follows the same four steps:
//
//   1. POST /api/live/stream            open a session; the response carries its id
//   2. POST /api/live/:id/turns         one request per finished turn, in call order
//   3. GET  /api/live/:id/events        Server-Sent Events: the whole session after every change
//   4. POST /api/live/:id/control       {"action":"end"} once the call is over; the server
//                                       runs a final pass over the complete transcript
//
// The server scores in the background. At most one scoring pass per session is in flight;
// turns that arrive while it runs are picked up together by the next pass, so a source
// can post as fast as turns happen and never has to wait for scoring.
//
// Plain Node (22 or newer), no dependencies. Usage:
//
//   node scripts/stream-demo.mjs [--api http://127.0.0.1:3001] [--provider gemini|openai|jev]
//                                [--pace-ms 1000] [--score-every 2]
//
// Each flag can also come from the environment: SCORECARD_API (the server's origin; a
// trailing /api is accepted too), SCORECARD_PROVIDER, STREAM_PACE_MS, STREAM_SCORE_EVERY.
// Without a provider the server uses its default (the first provider with a key
// configured). The transcript below is fictional.

import { parseArgs } from 'node:util';

const { values: flags } = parseArgs({
  // `pnpm stream-demo -- --provider jev` passes the separator through; ignore it.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  options: {
    api: { type: 'string' },
    provider: { type: 'string' },
    'pace-ms': { type: 'string' },
    'score-every': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (flags.help) {
  console.log(
    'Usage: node scripts/stream-demo.mjs [--api URL] [--provider gemini|openai|jev] [--pace-ms N] [--score-every N]',
  );
  process.exit(0);
}

// Every route lives under /api on the server's origin.
const API = `${(flags.api ?? process.env.SCORECARD_API ?? 'http://127.0.0.1:3001')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '')}/api`;
const PROVIDER = flags.provider ?? process.env.SCORECARD_PROVIDER ?? undefined;
const PACE_MS = Number(flags['pace-ms'] ?? process.env.STREAM_PACE_MS ?? 1000);
const SCORE_EVERY = Number(flags['score-every'] ?? process.env.STREAM_SCORE_EVERY ?? 2);
// How long to wait for the final evaluation after the call has ended.
const FINAL_TIMEOUT_MS = 120_000;

// A short fictional call. In a real integration each entry would be one finished turn
// from the transcription source, posted the moment the speaker stops.
const CALL = {
  subject: 'Parcel marked delivered but not received',
  customerName: 'Dana Whitfield',
  agentName: 'Leo Marsh',
};
const TURNS = [
  {
    speaker: 'employee',
    text: "Thanks for calling Northwind Parcel, this is Leo. Who am I speaking with, and what's happened?",
  },
  {
    speaker: 'customer',
    text: "It's Dana Whitfield. The app says my parcel was delivered yesterday at two, but there's nothing here. It's my daughter's birthday present and I'm honestly pretty annoyed.",
  },
  {
    speaker: 'employee',
    text: "I'm sorry, Dana, that's frustrating, especially with a birthday coming. Before I open the delivery record, can you confirm the postcode and the last four digits of the tracking number?",
  },
  { speaker: 'customer', text: 'Postcode is NW4 2QT and the tracking number ends 7731.' },
  {
    speaker: 'employee',
    text: 'Thank you, that matches. The driver scanned it at 2:04 pm and the photo shows it left by a side gate. Do you have a side gate, or could it be with a neighbour?',
  },
  {
    speaker: 'customer',
    text: "There's a side gate, I checked there already. Nothing. I don't want to hear that I have to wait a week.",
  },
  {
    speaker: 'employee',
    text: "Understood. I've opened a missing-parcel investigation, reference MP-55120, and because the photo doesn't match your address I can send a replacement today on next-day delivery at no cost.",
  },
  {
    speaker: 'customer',
    text: 'Oh, that would actually solve it. So it arrives tomorrow?',
  },
  {
    speaker: 'employee',
    text: "Yes, by 6 pm tomorrow. You'll get a text with the new tracking number within the hour, and if the original turns up you can just refuse it at the door.",
  },
  { speaker: 'customer', text: "Great, thank you Leo, that's a relief." },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (value) => `${Math.round(value * 100)}%`;
const score = (value) => (value === null || value === undefined ? 'not yet' : value.toFixed(1));

// Every endpoint answers errors as { statusCode, message, error }; message may be a list
// when request validation failed.
const request = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(payload?.message)
      ? payload.message.join('; ')
      : (payload?.message ?? response.statusText);
    throw new Error(`${method} ${path} failed with ${response.status}: ${message}`);
  }
  return payload;
};

// Follow the session over Server-Sent Events. Each event's data is the full session
// (LiveSessionDetail), so a client never has to merge partial updates. Resolves with the
// session once it is completed or failed.
const follow = (id, onUpdate, signal) =>
  new Promise((resolve, reject) => {
    (async () => {
      const response = await fetch(`${API}/live/${id}/events`, {
        headers: { Accept: 'text/event-stream' },
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`events stream: HTTP ${response.status}`);
      const decoder = new TextDecoder();
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          const session = JSON.parse(data);
          onUpdate(session);
          if (session.status === 'completed' || session.status === 'failed') {
            resolve(session);
            return;
          }
        }
      }
      reject(new Error('events stream closed before the session finished'));
    })().catch(reject);
  });

// Print one line per scoring pass, when a new evaluation lands.
let lastEvaluationId = null;
let passes = 0;
const onUpdate = (session) => {
  const evaluation = session.evaluation;
  if (!evaluation || evaluation.id === lastEvaluationId) return;
  lastEvaluationId = evaluation.id;
  passes += 1;
  const latest = session.requests.at(-1);
  const pending =
    session.pendingTurnCount > 0 ? `, ${session.pendingTurnCount} turn(s) waiting` : '';
  console.log(
    `    [pass ${passes}, ${evaluation.stage}] ${evaluation.turnCount} turns read: ` +
      `overall ${score(evaluation.overallScore)}, coverage ${pct(evaluation.coverage)}, ` +
      `${evaluation.usage.questions} questions in ${evaluation.usage.latencyMs} ms` +
      (latest ? ` (${session.totals.requests} requests so far)` : '') +
      pending,
  );
};

const main = async () => {
  console.log(
    `API ${API}, provider ${PROVIDER ?? '(server default)'}, one turn every ${PACE_MS} ms`,
  );

  // 1. Open the stream. scoreEveryTurns is how many unscored turns trigger a pass.
  const session = await request('POST', '/live/stream', {
    ...CALL,
    ...(PROVIDER ? { provider: PROVIDER } : {}),
    scoreEveryTurns: SCORE_EVERY,
  });
  console.log(`Session ${session.id} (${session.provider}), call ${session.callId}\n`);

  // 3. Start following before the first turn so no update is missed.
  const controller = new AbortController();
  const finished = follow(session.id, onUpdate, controller.signal);
  finished.catch(() => {});

  let ended = false;
  const endSession = async () => {
    if (ended) return;
    ended = true;
    await request('POST', `/live/${session.id}/control`, { action: 'end' });
  };
  process.once('SIGINT', () => {
    console.log('\nInterrupted: ending the session.');
    endSession()
      .catch(() => {})
      .finally(() => process.exit(130));
  });

  // 2. Post each turn as it "happens".
  for (const turn of TURNS) {
    const stored = await request('POST', `/live/${session.id}/turns`, turn);
    console.log(`${stored.id.padEnd(6)} ${turn.speaker.toUpperCase().padEnd(8)} ${turn.text}`);
    await sleep(PACE_MS);
  }

  // 4. End the call. The final pass reads the complete transcript.
  console.log('\nCall ended; waiting for the final evaluation.');
  await endSession();
  const timeout = sleep(FINAL_TIMEOUT_MS).then(() => {
    throw new Error('timed out waiting for the final evaluation');
  });
  const final = await Promise.race([finished, timeout]);
  controller.abort();

  if (final.status === 'failed') throw new Error(`scoring failed: ${final.error}`);
  printSummary(final);
  process.exit(0);
};

const printSummary = (session) => {
  const evaluation = session.evaluation;
  const { coaching } = evaluation;
  const totals = session.totals;
  console.log('\nFinal evaluation');
  console.log(`  Overall score  ${score(evaluation.overallScore)} / 100`);
  console.log(
    `  Coverage       ${pct(evaluation.coverage)} of scorecard weight could be judged ` +
      `(channels: ${evaluation.channels.join(', ')})`,
  );
  console.log(`  Confidence     ${pct(evaluation.confidence)}`);
  console.log(`  Headline       ${coaching.headline}`);
  for (const skill of evaluation.skills) {
    const level = skill.assessed ? skill.levels[skill.level].label : 'not assessed';
    console.log(
      `    ${skill.name.padEnd(28)} ${skill.assessed ? skill.normalizedScore.toFixed(1).padStart(5) : '    -'}  ${level}`,
    );
  }
  const list = (title, points) => {
    console.log(`  ${title}`);
    if (points.length === 0) console.log('    (none)');
    for (const point of points) {
      console.log(
        `    - ${point.title} [${point.skillName}; turns ${point.turnIds.join(', ') || '-'}]`,
      );
      console.log(`      ${point.detail}`);
    }
  };
  list('Strengths', coaching.strengths);
  list('Opportunities', coaching.opportunities);
  if (coaching.flags.length > 0) list('Flags', coaching.flags);
  if (coaching.focus) {
    console.log(
      `  Focus          ${coaching.focus.skillName}: from "${coaching.focus.levelLabel}" to "${coaching.focus.nextLevelLabel}"`,
    );
  }
  if (coaching.reviewReasons.length > 0) {
    console.log(`  Needs review   ${coaching.reviewReasons.join('; ')}`);
  }
  console.log(
    `\nUsage: ${totals.requests} requests, ${totals.questions} questions, ` +
      `${totals.inputTokens.toLocaleString('en-US')} input tokens, about $${totals.estimatedCostUsd.toFixed(4)}, ` +
      `average ${totals.latencyAvgMs ?? '-'} ms and P95 ${totals.latencyP95Ms ?? '-'} ms per request`,
  );
};

main().catch((error) => {
  // fetch reports "fetch failed" and keeps the reason (such as ECONNREFUSED) in `cause`.
  const cause = error.cause?.message ?? error.cause?.code;
  console.error(`stream-demo: ${error.message}${cause ? ` (${cause})` : ''}`);
  if (cause) console.error(`Is the API running at ${API}? Start it with "pnpm dev".`);
  process.exit(1);
});
