#!/usr/bin/env node
// Captures one real request and response per decision provider for the same short call,
// so the three wire formats can be read side by side in docs/provider-examples/.
//
// It runs the application's own code rather than a copy: the compiled adapters from
// dist/decisions/adapters build each provider's JSON, and the compiled question planner
// builds the questions exactly as a scoring pass would (final stage, nothing read yet).
// Each adapter is given a recording `fetch` that keeps the URL, the request body and the
// response body. Headers, and with them the API keys, are never recorded.
//
// Usage, from apps/api (the build step is needed only when dist is missing or stale):
//
//   pnpm build
//   pnpm provider-examples                 # every provider whose key is set
//   pnpm provider-examples -- jev openai   # only these
//
// Keys come from the environment or the repository's .env: GEMINI_API_KEY,
// OPENAI_API_KEY, JEV_API_KEY. A provider without a key is skipped. One run costs well
// under a cent per provider.

import 'reflect-metadata';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeEvaluation,
  defaultScorecard,
  emptyScoringState,
  PROVIDER_ORDER,
  PROVIDERS,
} from '@scorecard/domain';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const outDir = join(here, '..', '..', '..', 'docs', 'provider-examples');

const load = async (path) => {
  try {
    return await import(join(dist, path));
  } catch (cause) {
    throw new Error(`could not load dist/${path}; run "pnpm build" in apps/api first`, { cause });
  }
};
const { GeminiAdapter } = await load('decisions/adapters/gemini.adapter.js');
const { OpenAiAdapter } = await load('decisions/adapters/openai.adapter.js');
const { JevAdapter } = await load('decisions/adapters/jev.adapter.js');
const { planQuestions, renderTranscript, applyAnswers } = await load('scoring/question-plan.js');

const ADAPTERS = { gemini: GeminiAdapter, openai: OpenAiAdapter, jev: JevAdapter };

// A short fictional call, the same for every provider.
const CALL = {
  id: 'call-example-001',
  subject: 'Locked out after a password reset',
  customerName: 'Priya Natarajan',
  agentName: 'Marcus Bell',
};
const TURNS = [
  {
    speaker: 'employee',
    text: 'Thanks for calling Contoso support, this is Marcus. How can I help today?',
  },
  {
    speaker: 'customer',
    text: "I reset my password an hour ago and now it says my account is locked. I've got a client presentation in twenty minutes and everything is in there.",
  },
  {
    speaker: 'employee',
    text: "That's a stressful spot with a presentation so close, so let's move quickly. To make sure I'm talking to the account holder, can you confirm the email on the account and the code I've just sent to your phone?",
  },
  {
    speaker: 'customer',
    text: "It's priya.n@example.com, and the code is 482 913.",
  },
  {
    speaker: 'employee',
    text: "Thank you, you're verified. Three failed sign-ins after the reset triggered the lock. I've cleared it now; please sign in with the new password while I stay on the line.",
  },
  {
    speaker: 'customer',
    text: "I'm in. Thank you, that was quick.",
  },
].map((turn, index) => ({ id: `turn-${index + 1}`, startSeconds: index * 15, ...turn }));

const STAGE = 'final';
const transcript = renderTranscript(CALL, TURNS, STAGE);
const planned = planQuestions(defaultScorecard, TURNS, emptyScoringState, STAGE);
const questions = Object.fromEntries(planned.map((item) => [item.key, item.question]));

// A fetch that records what went over the wire. Only the URL and the two bodies are
// kept; the request headers carry the key and are deliberately left out.
const recordingFetch = (log) => async (url, init) => {
  const started = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  log.url = String(url);
  log.status = response.status;
  log.roundTripMs = Math.round(performance.now() - started);
  log.requestBody = JSON.parse(init.body);
  try {
    log.responseBody = JSON.parse(text);
  } catch {
    log.responseBody = text;
  }
  return new Response(text, { status: response.status, headers: response.headers });
};

const requested = process.argv.slice(2).filter((arg) => arg !== '--');
const providers = PROVIDER_ORDER.filter(
  (provider) => requested.length === 0 || requested.includes(provider),
);

const summary = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  call: { id: CALL.id, subject: CALL.subject, turns: TURNS.length },
  scorecard: defaultScorecard.name,
  stage: STAGE,
  questionCount: planned.length,
  questionTypes: planned.reduce((counts, item) => {
    counts[item.question.type] = (counts[item.question.type] ?? 0) + 1;
    return counts;
  }, {}),
  providers: {},
};

await mkdir(outDir, { recursive: true });

for (const provider of providers) {
  const info = PROVIDERS[provider];
  const apiKey = process.env[info.envVar]?.trim();
  if (!apiKey) {
    console.log(`${info.label}: skipped, ${info.envVar} is not set`);
    continue;
  }
  const log = {};
  const adapter = new ADAPTERS[provider](recordingFetch(log));
  try {
    const result = await adapter.decide({ input: transcript, questions, apiKey });
    const state = applyAnswers(emptyScoringState, planned, result.answers);
    const evaluation = composeEvaluation(defaultScorecard, state, TURNS, STAGE);
    summary.providers[provider] = {
      label: info.label,
      model: result.model,
      endpoint: log.url,
      httpStatus: log.status,
      questions: Object.keys(result.answers).length,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      roundTripMs: log.roundTripMs,
      estimatedCostUsd: Number(
        ((result.inputTokens * info.pricing.inputUsdPerMillion) / 1_000_000).toFixed(6),
      ),
      overallScore: evaluation.overallScore,
    };
    console.log(
      `${info.label}: ${planned.length} questions, ${result.inputTokens} input tokens, ${log.roundTripMs} ms, overall ${evaluation.overallScore}`,
    );
  } catch (error) {
    // Keep whatever came back, so a rejected request is still visible in the files.
    summary.providers[provider] = {
      label: info.label,
      error: error.message,
      httpStatus: log.status ?? null,
    };
    console.log(`${info.label}: failed (${error.message})`);
  }
  if (log.requestBody !== undefined) {
    await writeFile(
      join(outDir, `${provider}-request.json`),
      `${JSON.stringify({ method: 'POST', url: log.url, body: log.requestBody }, null, 2)}\n`,
    );
    await writeFile(
      join(outDir, `${provider}-response.json`),
      `${JSON.stringify({ status: log.status, body: log.responseBody }, null, 2)}\n`,
    );
  }
}

await writeFile(join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`Wrote ${outDir}`);
