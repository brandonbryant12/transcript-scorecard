# Transcript Scorecard

Transcript Scorecard scores customer-support calls against a weighted scorecard of skills, rubrics and behaviours, during the call and after it. It asks decision-model APIs (Gemini Decisions, OpenAI Decisions and TypeSafe JEV) yes/no, choice and rubric questions about the transcript and, where the provider accepts it, the audio and video of each turn; those APIs return calibrated probabilities and generate no text. Everything a coach reads is composed in code from those probabilities and from text written in the scorecard, and coach ratings of the same calls measure how far the scores can be trusted.

All calls, people and companies in the seed data are fictional.

## Contents

- [Quick start](#quick-start)
- [What you can do in the app](#what-you-can-do-in-the-app)
- [How scoring works](#how-scoring-works)
- [Providers](#providers)
- [Real-time sources](#real-time-sources)
- [Ground truth and validation](#ground-truth-and-validation)
- [Architecture](#architecture)
- [HTTP API](#http-api)
- [Environment variables](#environment-variables)
- [Commands](#commands)
- [Limits](#limits)
- [Further reading](#further-reading)

## Quick start

Prerequisites: Node.js 22 or newer and pnpm 10 or newer. The workspace pins its runtime to Node.js 22.22.3 (`useNodeVersion` in `pnpm-workspace.yaml`, and `.nvmrc` for nvm users); pnpm downloads that version on first use and runs every project script with it, so the native SQLite module is always built for the same Node ABI it runs on.

```bash
git clone https://github.com/brandonbryant12/transcript-scorecard.git
cd transcript-scorecard
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Put at least one key in .env: GEMINI_API_KEY, OPENAI_API_KEY or JEV_API_KEY.
pnpm dev
```

- Web app: http://localhost:5173 (Angular dev server; it proxies `/api`, including WebSockets, to the API).
- API: http://127.0.0.1:3001/api (bound to 127.0.0.1 only).

The API starts with whichever keys are present. An empty value counts as not configured, and a variable exported in your shell takes precedence over `.env`. At startup it logs the configured providers and the default, for example `Providers configured: Gemini Decisions, OpenAI Decisions, JEV (default: Gemini Decisions)`. The default is the first configured provider in the order Gemini, OpenAI, JEV, and it is used whenever a request does not name a provider. With no key at all the API still starts and serves the seed data; scoring requests then fail with HTTP 503.

On first start the API creates `apps/api/data/scorecard.sqlite`, runs the migrations, and seeds nine fictional calls and version 1 of the default scorecard. Existing rows are never overwritten, so your edits and results survive restarts. The `data` directory is ignored by Git.

If SQLite reports a `NODE_MODULE_VERSION` mismatch after switching Node versions, stop `pnpm dev`, run `pnpm rebuild better-sqlite3`, and start it again. The data is kept.

## What you can do in the app

The web app (`apps/web`) has one page per feature under `apps/web/src/app/features`:

| Page | What it does |
| --- | --- |
| Live studio (`/live`, the start page) | Replay a stored call one turn at a time with a chosen provider, reveal pace and scoring cadence; watch the score, coverage, skills, customer journey, coaching and per-request telemetry update as turns arrive. |
| Practice call (`/practice`) | Speak as the support employee to an AI customer played by a real-time voice model, optionally with the camera on; the call is transcribed and scored live. Needs `GEMINI_API_KEY`. |
| Calls (`/calls`) | The call library with each call's latest evaluation; open a call for coaching, evidence by turn and the evaluations from each provider. |
| Coach review (`/coach-review`) | Rate a call on the same scorecard yourself. The AI's evaluation stays hidden until you submit. |
| Validation (`/validation`) | Agreement between coaches and each provider, with the human-vs-human baseline and the calls where they disagree. |
| Runs (`/runs`) | Score every call with one provider and compare runs on score, cost, latency and agreement with coaches. |
| Scorecard (`/scorecard`) | Edit skills, weights, rubric levels and behaviours, and publish them as a new immutable version. |

## How scoring works

The design and its reasoning are walked through in [docs/scoring-design.html](docs/scoring-design.html) (open it in a browser). In short:

**The scorecard.** A scorecard is a set of weighted skills (`packages/domain/src/scorecard.ts`). Each skill has an anchored rubric (ordered levels, each a label and a description) and a list of atomic behaviours. A behaviour is a statement that is true or false of one employee turn, such as "The employee restates the problem". It is positive (should happen) or negative (should not), may carry an "expected when" condition saying when a positive behaviour is called for, may be flagged critical (negative behaviours only), and carries a coaching tip written by a person. Each skill also has a channel: `verbal` (judged from the transcript), `vocal` (from an audio clip of each employee turn) or `visual` (from video frames of each employee turn). The default scorecard has five verbal skills plus one vocal and one visual skill.

**The questions** (`apps/api/src/scoring/question-plan.ts`). Each scoring pass sends the transcript so far, one line per turn with a bracketed turn id, and asks two lanes of questions against it:

- Turn lane: one yes/no question per new employee turn and behaviour ("is this statement true of turn [turn-5]?"), and a sentiment rubric plus an emotion choice per new customer turn. Every turn is read once; readings from earlier passes are kept in the session state and never asked again, so this lane grows with the length of the call rather than its square.
- Call lane, asked on every pass: a rubric score per skill, a fairness gate per skill ("can this skill be fairly judged from the call so far?"), an "expected" check per conditional behaviour, and escalation risk.

Vocal and visual skills go through a separate media lane: one request per captured clip, holding one turn's audio or frames and a single line saying whose they are, with a rubric question and the behaviour questions for each skill on that channel. No transcript travels with a clip, because measured runs showed the words beside a clip pull the reading of the voice towards them; and a visual behaviour is asked of each frame separately, because a brief lapse is averaged away when it is asked of a set (see the [modality notes](docs/research/modalities/NOTES.md)). A customer turn's audio gets one question, sentiment judged from the voice, which is kept beside the sentiment from the words. Only Gemini accepts media. When a call or a provider has no media, vocal and visual skills are reported as not assessed and carry no weight in the score or in coverage.

**Composition** (`packages/domain/src/scoring.ts`, `coaching.ts`, `method.ts`). Code, not the model, turns the probabilities into an evaluation:

- Overall score = sum(weight x observability x skill score) / sum(weight x observability), where observability is the fairness gate's probability. A skill the call has not reached yet neither helps nor hurts. Coverage is the share of the weight this call could show (skills whose channel it has) that was observable; below 10 percent there is no overall score yet.
- Behaviour status: positive behaviours are demonstrated, missed (called for but not seen) or not applicable; negative ones are violated or clear. A behaviour counts as detected in a turn at probability 0.6 or more.
- Customer journey: a valence per customer turn (the average of words and voice when both were read), the shifts between turns, and an arc such as recovered, improved or declined.
- Coaching: a headline, up to three strengths and three opportunities, critical flags and a focus skill with the next rubric level to aim for. Every sentence comes from the scorecard (behaviour names, statements, tips and level descriptions); the code only chooses which ones the call earned.
- Review reasons route a call to a human: a critical behaviour, a rubric distribution split between distant levels, or a rubric score that contradicts the behaviours.

The tunable constants live in `SCORING_METHOD` (`packages/domain/src/method.ts`) and every evaluation records the method version. Composition is a pure function of the readings, so the same readings always compose to the same evaluation, and a threshold change can be tried on stored readings without calling a provider again.

## Providers

All three providers take a shared input and a set of typed questions and return probabilities. Each has an adapter under `apps/api/src/decisions/adapters` that translates a neutral question set to its wire format; output is not billed by any of them.

| Provider | Model | Endpoint | Key | USD per 1M input tokens | Media |
| --- | --- | --- | --- | --- | --- |
| Gemini Decisions | `gemini-decision-1` | `https://generativelanguage.googleapis.com/v1beta/decisions` | `GEMINI_API_KEY` | 0.10 | Audio and images |
| OpenAI Decisions | `gpt-6-luna` | `https://api.openai.com/v1/decisions` | `OPENAI_API_KEY` | 0.10 | Text only |
| TypeSafe JEV | `jev-latest` | `https://api.typesafe.ai/v1/systemone` | `JEV_API_KEY` | 0.042 | Text only |

Prices, documentation links and the dates they were checked are in `packages/domain/src/providers.ts`. One real request and response per provider for the same six-turn call is in [docs/provider-examples/](docs/provider-examples/), with a `summary.json` of question count, tokens and round-trip time; regenerate them with `pnpm --filter @scorecard/api provider-examples`.

### Observations

Taken on 2026-11-11 from one development machine against the live APIs. Each line is a single run, not a benchmark; latency includes the network path from that machine.

| What | Provider | Requests | Questions | Input tokens | Cost | Latency |
| --- | --- | --- | --- | --- | --- | --- |
| One 28-turn call scored in full | Gemini | 1 | 289 | 28.8K | about $0.003 | 1,044 ms |
| Batch of the 9 seeded calls | Gemini | 11 | 2,081 | 213K | about $0.021 | P50 801 ms, P95 1,660 ms |
| Batch of the 9 seeded calls | JEV | 11 | 2,081 | 161K | about $0.007 | P50 200 ms, P95 433 ms |
| Batch of 12 calls (the 9 seeded calls and 3 earlier stream calls) | OpenAI | 14 | 2,310 | 463K | about $0.046 | P50 724 ms, P95 1,381 ms |
| Live replay of `call-1001` (24 turns), scoring every 2 turns | Gemini | 12 | 506 | 56.6K | about $0.006 | average 364 ms, P95 550 ms |
| Voice practice call, 6 turns, per-turn audio | Gemini | 13 | 227 | 27.9K | about $0.003 | audio-clip requests 540 to 850 ms |
| `stream-demo` script, 10 turns | JEV | 6 | 228 | 20.8K | about $0.001 | average 114 ms, P95 184 ms |

- Average overall score on the 9 seeded calls: 68.8 with Gemini, 69.2 with JEV and 60.9 with OpenAI.
- In the practice call each audio-clip request was 500 to 1,100 input tokens.
- For the identical 77-question request in `docs/provider-examples`, OpenAI reported 15,218 input tokens, Gemini 7,845 and JEV 6,081, with round trips of 454 ms, 615 ms and 245 ms. At the same list price, OpenAI therefore cost about twice as much as Gemini for the same work in these runs.
- An earlier single-request probe of 357 questions took 444 ms on JEV and 1,188 ms on OpenAI.

## Real-time sources

Live scoring runs on live sessions (`apps/api/src/live`). A session is fed in one of two ways, and both end in the same place: new turns on the session and a scoring pass.

- **Replay** (`POST /api/live`): a stored call is revealed one turn per interval (default 1 second, 250 ms to 30 s) and a pass runs once a set number of turns is unscored (default 2, from 1 to 25). It can be started, paused, re-paced and reset.
- **Stream** (`POST /api/live/stream`): a call that does not exist yet. Any real-time source (a speech-to-text service, a contact-centre platform, a voice model, a script) posts each finished turn to `POST /api/live/:id/turns` and ends the call with `POST /api/live/:id/control {"action":"end"}`, which triggers a final pass over the complete transcript.

At most one scoring pass per session is in flight. Turns that arrive while it runs are picked up together by the next pass, so a slow provider never builds a queue and a source never waits for scoring. Every pass is saved as a provisional evaluation; the pass after the input ends is the final one. Clients follow a session with Server-Sent Events at `GET /api/live/:id/events`: each event carries the whole session (transcript, latest evaluation, score history, request ledger and totals), first on connect and then after every change. The event stream stays open after the session completes; close it when `status` is `completed` or `failed`.

A stream from the command line (needs `jq`; omit `provider` to use the server default):

```bash
API=http://127.0.0.1:3001/api
SESSION=$(curl -s -X POST $API/live/stream -H 'Content-Type: application/json' \
  -d '{"subject":"Refund for a cancelled order","customerName":"Sam","agentName":"Alex","provider":"jev","scoreEveryTurns":2}' | jq -r .id)

# In a second terminal, watch the updates:
curl -N $API/live/$SESSION/events

curl -s -X POST $API/live/$SESSION/turns -H 'Content-Type: application/json' \
  -d '{"speaker":"employee","text":"Thanks for calling, this is Alex. How can I help?"}'
curl -s -X POST $API/live/$SESSION/turns -H 'Content-Type: application/json' \
  -d '{"speaker":"customer","text":"I cancelled an order last week and the refund still has not arrived."}'
curl -s -X POST $API/live/$SESSION/control -H 'Content-Type: application/json' -d '{"action":"end"}'

curl -s $API/live/$SESSION | jq '{status, score: .evaluation.overallScore, coverage: .evaluation.coverage, headline: .evaluation.coaching.headline}'
```

A turn is `{"speaker":"employee"|"customer","text":"...","startSeconds":12.5}`; `startSeconds` is optional. [`apps/api/scripts/stream-demo.mjs`](apps/api/scripts/stream-demo.mjs) does the same with a ten-turn call and prints each pass and the final coaching; it is the reference for wiring up a new source.

The HTTP ingest takes text turns. Audio clips and video frames reach the media lane only from the practice call, which runs in the same process.

### Practice call

The practice call (`apps/api/src/practice`) lets a person rehearse against an AI customer:

1. The browser opens a WebSocket at `/api/practice` and sends `start` with a scenario, the employee's name, an optional scoring provider and whether the camera is on. Messages are JSON `{ "event", "data" }` objects; the types are `PracticeClientMessage` and `PracticeServerMessage` in `packages/domain/src/records.ts`.
2. The browser streams microphone audio (`audio`, base64 PCM16, 16 kHz mono) and, with the camera on, JPEG frames (`frame`). The server answers with the customer's voice (`audio`, PCM16, 24 kHz mono), live `caption`s, `interrupted` when the employee speaks over the customer, and `ended`.
3. Behind the gateway, a real-time voice model (Gemini Live, `gemini-3.8-live`) plays the customer from a private scenario brief. It transcribes both sides; each finished turn is appended to a stream session that scores every turn.
4. When the scoring provider accepts media (Gemini), each turn's audio clip (up to 30 seconds, as WAV; clips under a second or too quiet to contain speech are dropped) and up to three frames are kept for the media lane. They are held in memory for the session only and dropped after the final pass; they are never written to the database or to disk.

The voice model's key stays on the server; the browser never talks to the model. The practice call needs `GEMINI_API_KEY` for the voice model whichever provider scores it.

To try it without a microphone, `pnpm --filter @scorecard/api practice-demo` plays the browser's part from the command line on macOS: it speaks a short employee script with the system text-to-speech, lets the voice model answer, and prints the scored result. Add `--frames a.jpg,b.jpg,c.jpg` to send camera frames as well.

Gemini Live note: the WebSocket API accepts `responseModalities` only under `setup.generationConfig`. The WebSocket quickstart page shows it at the top level of `setup`, which the API rejects. `apps/api/src/practice/gemini-live.model.ts` uses the working form.

To use a different real-time voice model, implement the `RealtimeModel` interface in `apps/api/src/practice/realtime-model.ts` (`connect(options, events)` returning `sendAudio` and `close`, and calling back with audio, input and output transcripts, speech start and end offsets, turn completion and interruptions) and provide your class for the `REALTIME` token in `practice.module.ts`. The interface also carries the model's name, the environment variable its credential comes from and an `isAvailable()` check, which the health endpoint and the gateway read, so nothing else in the API or the scoring path changes.

## Ground truth and validation

Scores are only as useful as their agreement with people, so coaches rate calls on the same scorecard (`apps/api/src/reviews`):

1. On the Coach review page a coach enters a name, takes a call from the queue and rates each skill on its rubric and each behaviour as yes, no or not applicable. Unreviewed calls come first, and among them the calls the AI is least sure about. The queue never shows what the AI scored.
2. A review can be saved as a draft. Only submitted reviews count as ground truth. There is one review per coach per call, pinned to the scorecard version active when it was saved.
3. `GET /api/validation` (the Validation page) sets every submitted review against the newest final evaluation of the same call from each provider and reports, per provider and per skill: exact and within-one-level agreement, mean absolute error and bias in rubric levels, quadratic weighted kappa, overall-score error, behaviour agreement with precision and recall, confidence calibration buckets, and a list of disagreements. When two or more coaches have rated the same call it also reports their agreement with each other, the human-vs-human baseline that the AI can reasonably be held to.
4. Every run (`GET /api/runs`) also reports its agreement with submitted coach reviews of the calls it scored.

The thresholds in `SCORING_METHOD` are defaults. Collect coach labels first, then tune them against the validation report.

## Architecture

```text
apps/
  api/       NestJS 12 HTTP API, SSE and WebSocket gateway, scoring engine, SQLite through TypeORM
  web/       Angular 22 single-page app (standalone components, signals)
packages/
  domain/    Zod schemas, shared contracts and pure scoring logic, built to dist/
docs/
  scoring-design.html      design and philosophy walkthrough
  provider-examples/       captured request and response per provider
  research/modalities/     transcript vs audio vs video experiments
  presentations/           informal slide decks
```

pnpm workspaces and Turborepo run the tasks; every task depends on `@scorecard/domain` being built first.

### API modules

The API (`apps/api/src`) is ESM. Request bodies and parameters are validated with Zod schemas from `@scorecard/domain` through Nest's `StandardSchemaValidationPipe`, so the web app and the API share one definition of every input.

| Module | Owns |
| --- | --- |
| `database` | The TypeORM data source, migrations (run on startup) and seeding. |
| `decisions` | Provider keys and the default provider (`CredentialsService`), the three adapters, and `DecisionClient`, the one entry point for asking questions. |
| `scorecards` | The active scorecard and publishing new immutable versions. |
| `calls` | The call library, call detail with the latest evaluation per provider, and calls created by streams. |
| `scoring` | Question planning and `ScoringEngine`: one pass plans the questions, asks them (requests split at 300 questions; one request per media clip), folds the answers into the readings and composes the evaluation. |
| `evaluations` | Storing evaluations with their flat skill and behaviour rows. |
| `runs` | Batch runs (two calls at a time, final stage) and the per-request ledger shared with live sessions. |
| `live` | `LiveCoordinator` (replay timers, stream ingest, one pass in flight per session, SSE), session storage and the in-memory media store. |
| `practice` | The practice-call WebSocket gateway, turn and clip segmentation, scenarios, and the `RealtimeModel` interface with its Gemini Live implementation. |
| `reviews` | Coach reviews and the review queue. |
| `validation` | The validation report. |
| `health`, `common` | `GET /api/health` and the filter that maps provider failures to HTTP 502 or 503. |

### Domain package

`packages/domain` has no runtime dependency other than Zod and is used by both apps: the scorecard schema and default scorecard, provider metadata and prices, the evaluation and record types, `SCORING_METHOD`, the pure composition functions (`composeEvaluation`, `buildCoaching`, `weightedOverall`) and the agreement statistics. Build it with `pnpm --filter @scorecard/domain build`; `pnpm dev` keeps it compiled in watch mode.

### Data model

Entities live next to the module that owns them (`apps/api/src/**/*.entity.ts`); the full list is `apps/api/src/database/entities.ts`.

| Table | Holds |
| --- | --- |
| `scorecards` | One row per scorecard. |
| `scorecard_versions` | Immutable scorecard definitions. Publishing an edit adds the next version; runs, evaluations and reviews record the version they used. |
| `calls` | Call metadata and transcript; `source` is `seed` or `stream`. |
| `scoring_runs`, `run_calls` | A batch or live run (provider, scorecard version, method version, status) and its calls. |
| `provider_requests` | One row per provider API call: stage, turn count, question count, tokens, latency, estimated cost and success. |
| `evaluations` | One row per scoring pass, provisional or final, with headline numbers and the full evaluation document. |
| `skill_results`, `behavior_results` | The evaluation flattened to one row per skill and per behaviour, for querying. |
| `live_sessions` | Source, pacing, reveal progress, status and the raw readings gathered so far. |
| `coach_reviews`, `coach_skill_ratings`, `coach_behavior_labels` | Coach reviews (one per coach per call) and their ratings and labels. |

### Migrations

The schema is owned by migrations in `apps/api/src/database/migrations`; `synchronize` is off. Migrations run automatically when the API starts and are listed explicitly, oldest first, in `migrations/index.ts`. A database created by the first version of this project is kept: its tables are renamed to `legacy_v1_*` and the current schema is created beside them.

To generate a migration after changing an entity, compile the API and point the TypeORM CLI at the compiled data source and a scratch database that has the current migrations applied:

```bash
cd apps/api
export SCORECARD_DB_PATH=/tmp/scorecard-migrations.sqlite
pnpm migration:run
pnpm migration:generate src/database/migrations/AddSomething
```

Both scripts build the API first and run the TypeORM CLI against the compiled data source. Then add the new class to `MIGRATIONS` in `src/database/migrations/index.ts`.

## HTTP API

Every route is under `/api`. Inputs are validated against the Zod schemas named in the controllers.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Which providers have a key, the default provider, and whether the practice call is available. Keys never leave the server. |
| GET | `/api/scorecard` | The active scorecard version and the version history. |
| PUT | `/api/scorecard` | Publish a scorecard definition as the next version. |
| GET | `/api/calls` | Every call with its latest final evaluation. |
| GET | `/api/calls/:id?provider=` | One call with transcript and evaluation (that provider's latest, or the most recent). |
| GET | `/api/runs` | Runs with metrics: requests, questions, tokens, cost, latency P50 and P95, agreement with coaches. |
| POST | `/api/runs` | Start a batch run. Body `{"provider"?, "callIds"?}`. Returns 202 at once; follow it with `GET /api/runs/:id`. |
| GET | `/api/runs/:id` | One run with per-call results. |
| POST | `/api/live` | Create a replay session. Body `{"callId", "provider"?, "intervalMs"?, "scoreEveryTurns"?}`. |
| POST | `/api/live/stream` | Create a stream session. Body `{"subject", "customerName", "agentName", "provider"?, "scoreEveryTurns"?}`. |
| GET | `/api/live/:id` | The session now. |
| GET | `/api/live/:id/events` | Server-Sent Events: the session on connect and after every change. |
| POST | `/api/live/:id/turns` | Append a turn to an open stream. 409 if the session is not an open stream. |
| POST | `/api/live/:id/control` | `{"action": "start" \| "pause" \| "reset" \| "pace" \| "end", "intervalMs"?, "scoreEveryTurns"?}`. `end` closes a stream's input; the others drive a replay. |
| GET | `/api/practice/scenarios` | Practice scenarios (the customer's private brief stays on the server). |
| WebSocket | `/api/practice` | The practice call (see [Practice call](#practice-call)). |
| GET | `/api/reviews/queue` | Calls to review next. |
| GET | `/api/reviews?callId=` | Reviews of one call. |
| PUT | `/api/reviews` | Save or submit the coach's review of a call. |
| GET | `/api/validation` | The validation report. |

Errors use Nest's standard body:

```json
{ "statusCode": 404, "message": "Live session not found", "error": "Not Found" }
```

On a validation failure `message` is a list such as `["subject: Too small: expected string to have >=1 characters"]`. A provider without a key gives 503 and a provider failure (authentication, rate limit, timeout, rejected or malformed response) gives 502; neither message repeats transcript content. On the practice WebSocket, problems arrive as `{"event":"error","data":{"message":"..."}}`.

## Environment variables

Read by the API from the environment or from the repository-root `.env` (environment wins). They are validated at startup, and a bad value stops the process with a message naming the variable.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | unset | Gemini Decisions, and the Gemini Live voice model for practice calls. |
| `OPENAI_API_KEY` | unset | OpenAI Decisions. |
| `JEV_API_KEY` | unset | TypeSafe JEV. |
| `PORT` | `3001` | API port. The web dev server's proxy (`apps/web/proxy.conf.json`) expects 3001. |
| `SCORECARD_DB_PATH` | `./data/scorecard.sqlite` | SQLite file, relative to `apps/api`. `:memory:` gives a throwaway database. |

An empty key counts as not configured. The `stream-demo` script also reads `SCORECARD_API` (default `http://127.0.0.1:3001`), `SCORECARD_PROVIDER`, `STREAM_PACE_MS` and `STREAM_SCORE_EVERY`.

## Commands

From the repository root:

| Command | What it does |
| --- | --- |
| `pnpm dev` | Domain package in watch mode, API with `nest start --watch`, web dev server. |
| `pnpm build` | Build every package. |
| `pnpm typecheck` | Type-check every package. |
| `pnpm test` | Unit tests (Vitest in the API and domain package, the Angular test runner in the web app). |
| `pnpm format` | Prettier over the source and test files. |
| `pnpm --filter @scorecard/api test:e2e` | API end-to-end tests. |
| `pnpm --filter @scorecard/api lint` | oxlint with type-aware rules. |
| `pnpm --filter @scorecard/api stream-demo` | Stream a fictional ten-turn call into a running API and print each scoring pass and the final coaching. Flags: `--api`, `--provider`, `--pace-ms` (default 1000), `--score-every` (default 2). |
| `pnpm --filter @scorecard/api practice-demo` | Run a voice practice call from the command line with synthesised employee speech (macOS `say`), against a running API with `GEMINI_API_KEY`. Flags: `--provider`, `--scenario`, `--frames`, `--api`. |
| `pnpm --filter @scorecard/api provider-examples` | Send one real request per configured provider for a six-turn call and rewrite `docs/provider-examples/`. Needs a built API (`pnpm --filter @scorecard/api build`) and costs well under a cent per provider. Name providers to limit it: `... provider-examples jev openai`. |

Example:

```bash
pnpm --filter @scorecard/api stream-demo --provider jev
```

## Limits

- The calls, customers, employees and companies in the seed data and the scripts are fictional, and nine calls are far too few to judge accuracy.
- There is no authentication or authorisation. The API binds to 127.0.0.1 and is meant for local use.
- Coach blindness is a workflow, not access control. The review screen loads calls through a transcript-only route, so the AI's result is not sent to it before a review is submitted, but the API has no authentication and serves evaluations to anyone who asks for them directly.
- The thresholds in `SCORING_METHOD` (detection at 0.6, review when the rubric is split, and so on) are defaults until they are calibrated against coach labels.
- Each pass re-sends the whole transcript so far, because decision APIs have no context caching. Turn questions are asked once, but input tokens per pass grow with the call, so long calls cost more per pass; score less often (`scoreEveryTurns`) on long calls.
- Audio and video are used only in practice calls scored by Gemini, are held in memory for the session, and are never stored. A finished evaluation keeps the readings, not the recording. Replays and HTTP streams are transcript only.
- Provider prices are list prices recorded in `packages/domain/src/providers.ts`; costs shown in the app are estimates from reported token counts.

## Further reading

- [docs/scoring-design.html](docs/scoring-design.html): the scoring design and the reasoning behind it.
- [docs/research/modalities/NOTES.md](docs/research/modalities/NOTES.md): notes and experiments on scoring from the transcript, the audio and the video.
- [docs/provider-examples/](docs/provider-examples/): one captured request and response per provider.
- [What is JEV? A decision model](docs/presentations/what-is-jev/README.md) is an informal HTML slide deck covering classifiers, the JEV API, a real Titanic experiment, and application patterns. Open `docs/presentations/what-is-jev/what-is-jev.html` in a browser; it works offline.
