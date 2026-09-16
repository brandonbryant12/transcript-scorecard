# Transcript Scorecard

Transcript Scorecard is a runnable proof of concept for evaluating ACME support calls against a weighted employee scorecard. Its live replay reveals a realistic transcript about once per second and schedules a real TypeSafe AI evaluation for every new turn. When an evaluation is still running, incoming turns coalesce into the next request using the newest revealed transcript prefix. The weighted score recalculates as the conversation develops, and the final evaluation, evidence, confidence, and score history are persisted in SQLite.

## Stack

- pnpm workspaces and Turborepo
- React 19 and Vite
- Effect for typed application and service logic
- SQLite for local persistence
- A server-side TypeSafe AI integration for incremental transcript scoring

## Workspace

```text
apps/
  api/       HTTP API, live replay coordinator, classifier integration, and SQLite persistence
  web/       React live scorecard workspace
packages/
  domain/    Shared schemas, contracts, and score calculations
```

The browser talks to the API over HTTP. `JEV_API_KEY` is available only to the API development task and is never included in the Vite client environment.

## Run locally

Prerequisites: Node.js 22 or newer and pnpm 10 or newer.

```bash
git clone https://github.com/brandonbryant12/transcript-scorecard.git
cd transcript-scorecard
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
# Add your JEV_API_KEY to .env, or export it in the shell.
pnpm dev
```

If `JEV_API_KEY` is already exported in your shell, you can skip copying `.env.example`. The shell value takes precedence over `.env`.

Open [http://localhost:5173](http://localhost:5173). The API listens on [http://localhost:3001](http://localhost:3001). Choose a featured call, start the replay, and watch transcript turns and criterion scores arrive over time. You can pause, resume, or reset the replay without losing previously completed sessions.

The default SQLite database is created automatically at `apps/api/data/scorecard.sqlite` and is ignored by Git.

The live studio highlights the server-measured TypeSafe SDK round-trip duration for each successful scoring request, with recent request timings, average, and P95 latency. A running timer appears when an in-flight request is observed. Browser polling delay is excluded from completed timings; SDK retries, if any, are included.

Try **Cannot connect smart hub** for a strong opening followed by an accuracy drop, or **Duplicate subscription charge** for a rough opening followed by recovery. All calls are fictional; scores come from real TypeSafe API requests and may vary. Replays consume API usage. This local demo has no authentication.

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Turborepo runs each command across the apps and shared packages in dependency order.

## Environment

Copy `.env.example` to `.env` for local development. Do not prefix `JEV_API_KEY` with `VITE_`; Vite intentionally exposes variables with that prefix to browser code.

| Variable | Purpose | Default |
| --- | --- | --- |
| `JEV_API_KEY` | Server-side classifier credential | Required for live scoring |
| `PORT` | API listen port | `3001` |
| `SCORECARD_DB_PATH` | SQLite file location, resolved from `apps/api` | `./data/scorecard.sqlite` |
