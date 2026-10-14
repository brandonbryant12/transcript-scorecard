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

Prerequisites: Node.js 22 or newer and pnpm 10 or newer. This workspace pins its application runtime to Node.js 22.22.0. pnpm downloads that version on first use and runs project scripts with it, even when your shell uses a different Node version. `.nvmrc` selects the same version for nvm users.

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

If SQLite reports a `NODE_MODULE_VERSION` mismatch after switching Node versions, stop the API watcher and run `pnpm rebuild better-sqlite3`, then restart `pnpm dev`. The rebuild and dev scripts use the pinned workspace runtime; existing SQLite data is preserved.

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

## Provider API examples

These are real requests and responses from scoring one short, fictional call with both providers through the app's own adapter (`classifyTranscript`). They were captured on 2026-10-14. Each request asks 10 questions: a `score` and an `evidence__` choice for each of the four rubric criteria, plus the restated-problem and customer-emotion signals. The requests match what batch review sends; live replay requests add `assessment_stage`, `revealed_turns`, `total_turns`, and provisional-scoring guidance to `evaluation_context`. The full, unabridged payloads are in [`docs/provider-examples/`](docs/provider-examples/).

### Mock transcript

**Locked out after password reset.** Sam Rivera (customer) and Priya Patel (employee).

| Turn | Speaker | Text |
| --- | --- | --- |
| `turn-1` | Employee | ACME Support, this is Priya. How can I help? |
| `turn-2` | Customer | I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes. |
| `turn-3` | Employee | That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number? |
| `turn-4` | Customer | sam.rivera@example.com, and the phone ends in 4417. |
| `turn-5` | Employee | Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417. |
| `turn-6` | Customer | Got the code and I'm in. Thank you! |

### Latency

| | OpenAI Decisions | JEV |
| --- | --- | --- |
| Endpoint | `POST https://api.openai.com/v1/decisions` | `POST https://api.typesafe.ai/v1/systemone` |
| Model returned | `gpt-6-luna` | `jev-1.13.0` (requested `jev-latest`) |
| Input tokens | 2,832 | 2,933 |
| **Median latency** | **262 ms** | **168 ms** |
| Mean latency | 368 ms | 171 ms |
| Fastest / slowest | 199 ms / 934 ms | 143 ms / 212 ms |
| Estimated cost per request | $0.00028 | $0.00012 |
| Weighted score over 10 runs | 79.1 on every run | 82.6–83.4 |

Each provider received the same request 10 times. Requests ran one at a time, alternating providers and swapping which went first each round. Latency is the client-measured HTTP round trip from `fetch` call to fully read response body. It was measured from a local development machine on Node.js 22.22.0 over the public internet, and the first round includes connection setup. Two slow OpenAI requests (633 ms and 934 ms) pull up its mean; the per-round timings are in [`summary.json`](docs/provider-examples/summary.json). The app's server-measured provider latency, which the live studio displays, was 0–5 ms higher. This is a small snapshot from one location, not a benchmark, and results depend on network, region, and provider load. Cost uses the input rates listed under [Compare providers](#compare-providers).

Per-criterion results from the first captured request (scores use the 0–4 rubric):

| Criterion (weight) | OpenAI score · evidence | JEV score · evidence |
| --- | --- | --- |
| Empathy & active listening (25) | 3.34 · `turn-3` | 2.99 · `turn-3` |
| Accuracy & policy alignment (25) | 3.03 · `turn-5` | 3.34 · `turn-5` |
| Resolution quality (30) | 3.13 · `turn-5` | 3.20 · `turn-5` |
| Clear communication (20) | 3.17 · `turn-5` | 3.80 · `turn-5` |
| Restated the problem (probability) | 0.10 | 0.57 |
| Customer emotion | reassured (0.74) | reassured (0.99) |
| **Weighted score** | **79.1** | **82.6** |

### JEV request and response

The app sends this through `@typesafe-ai/sdk` (`client.systemOne`). The same request works over plain HTTP:

```bash
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $JEV_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @docs/provider-examples/jev-request.json
```

Request, abridged to three of the ten questions:

```jsonc
{
  "model": "jev-latest",
  "state": {
    "call": {
      "subject": "Locked out after password reset",
      "customer_name": "Sam Rivera",
      "employee_name": "Priya Patel",
      "transcript": [
        { "id": "turn-1", "speaker": "employee", "text": "ACME Support, this is Priya. How can I help?" }
        // turn-2 … turn-6, as in the transcript above
      ]
    },
    "evaluation_context": {
      "purpose": "Quality assurance scorecard for a customer support employee",
      "evidence_rule": "Base every judgment only on the supplied transcript"
    }
  },
  "questions": {
    "score__empathy": {
      "type": "score",
      "instructions": {
        "task": "Evaluate the employee on Empathy & active listening.",
        "definition": "Recognizes the customer’s emotion and responds to what they actually said.",
        "guidance": "Judge only behavior supported by this call. Use the full ordered rubric."
      },
      "criteria": [ "Dismissive", "Minimal acknowledgment", "Adequate", "Strong", "Exceptional" ]
    },
    "evidence__empathy": {
      "type": "choice",
      "instructions": {
        "task": "Which single transcript turn contains the most relevant employee behavior for assessing Empathy & active listening?",
        "definition": "Recognizes the customer’s emotion and responds to what they actually said.",
        "rubric": [ "Dismissive", "Minimal acknowledgment", "Adequate", "Strong", "Exceptional" ],
        "guidance": "Choose none only when no turn contains relevant employee behavior."
      },
      "criteria": {
        "none": "No transcript turn provides direct evidence for the judgment.",
        "turn-1": "Employee: ACME Support, this is Priya. How can I help?"
        // one option per transcript turn, through turn-6
      }
    },
    "signal__restated": {
      "type": "noul",
      "instructions": {
        "task": "Did the employee restate or summarise the customer's problem back to them in their own words?",
        "guidance": "Judge only the employee's turns in the supplied transcript."
      },
      "criteria": {
        "true": "The employee played the problem back, confirmed their understanding, or summarised the situation for the customer to confirm.",
        "false": "The employee moved straight to questions, instructions, or a fix without reflecting the problem back."
      }
    }
    // score__ and evidence__ for accuracy, resolution, and communication; signal__emotion
  }
}
```

Response, abridged to the same three answers (212 ms):

```jsonc
{
  "model": "jev-1.13.0",
  "answers": {
    "score__empathy": {
      "type": "score",
      "score": 2.99,
      "confidence": 0.93,
      "legend": { "0": "Dismissive", "1": "Minimal acknowledgment", "2": "Adequate", "3": "Strong", "4": "Exceptional" },
      "probabilities": { "0": 0, "1": 0, "2": 0.05, "3": 0.91, "4": 0.04 }
    },
    "evidence__empathy": {
      "type": "choice",
      "choice": "turn-3",
      "confidence": 1,
      "probabilities": { "none": 0, "turn-1": 0, "turn-2": 0, "turn-3": 1, "turn-4": 0, "turn-5": 0, "turn-6": 0 }
    },
    "signal__restated": { "type": "noul", "noul": 0.57 }
    // 7 more answers, keyed by question name
  },
  "usage": { "input_tokens": 2933, "output_tokens": 478 }
}
```

### OpenAI Decisions request and response

```bash
curl https://api.openai.com/v1/decisions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @docs/provider-examples/openai-request.json
```

The adapter in `apps/api/src/openai-decisions.ts` translates the JEV question set into the Decisions contract. `input` carries the same `state` object as a JSON string, questions become an ordered array with a `name`, score `criteria` become `levels`, and `noul` questions become `predicate` questions with the yes and no descriptions appended to the instructions.

Request, abridged to the same three questions:

```jsonc
{
  "model": "gpt-6-luna",
  // The JEV request's state object, serialized with JSON.stringify
  "input": "{\"call\":{\"subject\":\"Locked out after password reset\",\"customer_name\":\"Sam Rivera\",…},\"evaluation_context\":{…}}",
  "questions": [
    {
      "type": "score",
      "name": "score__empathy",
      "instructions": "{\"task\":\"Evaluate the employee on Empathy & active listening.\",\"definition\":\"Recognizes the customer’s emotion and responds to what they actually said.\",\"guidance\":\"Judge only behavior supported by this call. Use the full ordered rubric.\"}",
      "levels": [
        { "label": "Dismissive" },
        { "label": "Minimal acknowledgment" },
        { "label": "Adequate" },
        { "label": "Strong" },
        { "label": "Exceptional" }
      ]
    },
    {
      "type": "choice",
      "name": "evidence__empathy",
      "instructions": "{\"task\":\"Which single transcript turn contains the most relevant employee behavior for assessing Empathy & active listening?\",…}",
      "choices": [
        { "value": "none", "description": "No transcript turn provides direct evidence for the judgment." },
        { "value": "turn-1", "description": "Employee: ACME Support, this is Priya. How can I help?" }
        // one choice per transcript turn, through turn-6
      ]
    },
    {
      "type": "predicate",
      "name": "signal__restated",
      "instructions": "{\"task\":\"Did the employee restate or summarise the customer's problem back to them in their own words?\",\"guidance\":\"Judge only the employee's turns in the supplied transcript.\"}\nYes: The employee played the problem back, confirmed their understanding, or summarised the situation for the customer to confirm.\nNo: The employee moved straight to questions, instructions, or a fix without reflecting the problem back."
    }
    // 7 more questions, in the same order as the JEV request
  ]
}
```

Response, abridged to the same three answers (299 ms):

```jsonc
{
  "model": "gpt-6-luna",
  "answers": [
    {
      "type": "score",
      "name": "score__empathy",
      "score": 3.34,
      "probabilities": [
        { "value": 0, "label": "Dismissive", "probability": 0 },
        { "value": 1, "label": "Minimal acknowledgment", "probability": 0 },
        { "value": 2, "label": "Adequate", "probability": 0.01 },
        { "value": 3, "label": "Strong", "probability": 0.64 },
        { "value": 4, "label": "Exceptional", "probability": 0.35 }
      ],
      "confidence": 0.7
    },
    {
      "type": "choice",
      "name": "evidence__empathy",
      "choice": "turn-3",
      "probabilities": [
        { "value": "none", "probability": 0 },
        { "value": "turn-1", "probability": 0 },
        { "value": "turn-2", "probability": 0.04 },
        { "value": "turn-3", "probability": 0.95 },
        { "value": "turn-4", "probability": 0.01 },
        { "value": "turn-5", "probability": 0 },
        { "value": "turn-6", "probability": 0 }
      ],
      "confidence": 0.94
    },
    { "type": "predicate", "name": "signal__restated", "probability": 0.1 }
    // 7 more answers, in question order
  ],
  "usage": {
    "input_tokens": 2832,
    "input_tokens_details": { "cached_tokens": 0, "cache_write_tokens": 0 },
    "output_tokens": 0,
    "output_tokens_details": { "reasoning_tokens": 0 },
    "total_tokens": 2832
  }
}
```

The adapter validates this response and converts it back to the JEV answer shape, so both providers share the scoring, evidence, and signal logic.

### Reproduce

```bash
pnpm --filter @scorecard/api provider-examples
```

The script reads both keys from the shell or `.env`, runs 10 rounds by default (prefix the command with `ROUNDS=3` to run fewer), prints the per-request timings, and rewrites `docs/provider-examples/`. The JSON files keep request and response bodies only; the `Authorization` header is never written. Each run makes billable requests to both providers, and model outputs can vary between runs.

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
