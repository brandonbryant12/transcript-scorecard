# Transcript Scorecard

Transcript Scorecard is a runnable proof of concept for evaluating ACME support calls against a weighted employee scorecard. Its live replay reveals a realistic transcript at a configurable pace and evaluates batches with the selected provider. By default, one turn appears every 0.5 seconds and scoring runs every five turns. When an evaluation is still running, incoming turns coalesce into the next request using the newest revealed transcript prefix. The weighted score recalculates as the conversation develops, and the final evaluation, evidence, confidence, and score history are persisted in SQLite.

## Stack

- pnpm workspaces and Turborepo
- React 19 and Vite
- Effect for typed application and service logic
- SQLite for local persistence
- Server-side OpenAI Decisions and TypeSafe JEV adapters for incremental transcript scoring

## Workspace

```text
apps/
  api/       HTTP API, live replay coordinator, classifier integration, and SQLite persistence
  web/       React live scorecard workspace
packages/
  domain/    Shared schemas, contracts, and score calculations
```

The browser talks to the API over HTTP. `OPENAI_API_KEY` and `JEV_API_KEY` are available only to the API development task and are never included in the Vite client environment.

## Run locally

Prerequisites: Node.js 22 or newer and pnpm 10 or newer.

```bash
git clone https://github.com/brandonbryant12/transcript-scorecard.git
cd transcript-scorecard
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Add OPENAI_API_KEY for the default provider and JEV_API_KEY for comparison.
pnpm dev
```

If the provider keys are already exported in your shell, you can skip copying `.env.example`. The shell value takes precedence over `.env`.

Open [http://localhost:5173](http://localhost:5173). The API listens on [http://localhost:3001](http://localhost:3001). Choose a featured call, start the replay, and watch transcript turns and criterion scores arrive over time. You can pause, resume, or reset the replay without losing previously completed sessions.

The default SQLite database is created automatically at `apps/api/data/scorecard.sqlite` and is ignored by Git.

The live studio highlights the server-measured provider round-trip duration for each successful scoring request, with recent request timings, average, and P95 latency. A running timer appears when an in-flight request is observed. Browser polling delay is excluded from completed timings; JEV SDK retries, if any, are included. OpenAI requests have a 30-second timeout and no automatic retries.

Try **Cannot connect smart hub** for a strong opening followed by an accuracy drop, or **Duplicate subscription charge** for a rough opening followed by recovery. All calls are fictional; scores come from real provider API requests and may vary. Replays consume API usage. This local demo has no authentication.

## Compare providers

The **Scoring provider** toggle in the live studio and batch review defaults to **OpenAI Decisions** (`gpt-6-luna`). Choose **JEV** to use the existing `jev-latest` adapter. Each replay session and batch run keeps its chosen provider; switching never silently falls back to another service. The API reports a missing key for the selected provider without blocking access to saved sessions.

Replay the same call with each provider. Switching pauses the previous replay and restores the chosen provider's saved session, including scores, evidence, confidence, signals, and timings. The comparison table displays the two results only when their transcript prefixes and rubric match. Completed replays cover the full transcript and are the easiest comparison. Independent providers may produce different intermediate batch boundaries when request latency differs. Older JEV sessions and evaluations retain their original attribution.

The adapters share the transcript state, rubric, weights, and evidence choices. OpenAI uses `score`, `choice`, and `predicate` questions through [`POST /v1/decisions`](https://developers.openai.com/api/docs/guides/decisions); JEV uses the corresponding System One questions. OpenAI refusals and invalid or incomplete responses fail the scoring request instead of becoming fabricated scores.

Cost estimates use each provider's published input rate: OpenAI Decisions $0.10/M tokens and JEV $0.042/M tokens, with no output charges. These are estimates at the standard rates; regional processing premiums and long-context multipliers are excluded. Model IDs, actual tokens, and server-measured latency accompany the results. Comparing provider outputs is a demo, not an accuracy evaluation against labeled ground truth.

`POST /api/live` and `POST /api/runs` accept an optional `provider` of `openai` or `jev`; omitted values use OpenAI. `/api/health` reports configuration availability for each provider without exposing keys.

## Checks

```bash
pnpm typecheck --concurrency=2
pnpm test --concurrency=1 -- --maxWorkers=2 --minWorkers=1
pnpm build --concurrency=2
```

Turborepo runs each command across the apps and shared packages in dependency order.

## Environment

Copy `.env.example` to `.env` for local development. Do not prefix either API key with `VITE_`; Vite intentionally exposes variables with that prefix to browser code.

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Server-side OpenAI Decisions credential | Required for OpenAI scoring |
| `JEV_API_KEY` | Server-side TypeSafe JEV credential | Required for JEV scoring |
| `PORT` | API listen port | `3001` |
| `SCORECARD_DB_PATH` | SQLite file location, resolved from `apps/api` | `./data/scorecard.sqlite` |

## JEV presentation

[What is JEV? A decision model](docs/presentations/what-is-jev/README.md) is an informal HTML slide deck covering classifiers, the JEV API, a real Titanic experiment, and application patterns. Open `docs/presentations/what-is-jev/what-is-jev.html` in a browser; it works offline.
