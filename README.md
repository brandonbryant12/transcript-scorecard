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

These are real requests and responses from scoring one short, fictional call with both providers through the app's own adapter (`classifyTranscript`). They were captured on 2026-10-14. Each request asks 10 questions: a `score` and an `evidence__` choice for each of the four rubric criteria, plus the restated-problem and customer-emotion signals. The requests match what batch review sends; live replay requests add `assessment_stage`, `revealed_turns`, `total_turns`, and provisional-scoring guidance to `evaluation_context`. The exact payloads are below and in [`docs/provider-examples/`](docs/provider-examples/).

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

Shape, from the SDK's `SystemOneRequestPayload` and `SystemOneResult` types:

```ts
type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
type Entry = string | { [key: string]: Json } | Json[] | null // text, a JSON object or array, or null

// Request body
interface SystemOneRequest {
  model: string // "jev-latest"
  state: Entry // here { call, evaluation_context }
  questions: Record<string, Question> // answers come back under the same names
}

type Question =
  | { type: "score"; instructions?: Entry; criteria: [Entry, Entry, ...Entry[]] } // ordered rubric; index = score
  | { type: "choice"; instructions?: Entry; criteria: Record<string, Entry> } // label → description
  | { type: "noul"; instructions?: Entry; criteria?: { true?: Entry; false?: Entry } | null } // yes/no

// Response body
interface SystemOneResult {
  model: string // resolved model, e.g. "jev-1.13.0"
  answers: Record<string, Answer> // keyed by question name
  usage: { input_tokens: number; output_tokens: number }
}

type Answer =
  | {
      type: "score"
      score: number // expected score; may fall between rubric levels
      confidence: number
      legend: Record<string, Entry> // "0" … "n-1" → rubric level
      probabilities: Record<string, number> // "0" … "n-1" → probability
    }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number } // probability of yes
```

<details>
<summary>Exact request body (all 10 questions)</summary>

```json
{
  "model": "jev-latest",
  "state": {
    "call": {
      "subject": "Locked out after password reset",
      "customer_name": "Sam Rivera",
      "employee_name": "Priya Patel",
      "transcript": [
        {
          "id": "turn-1",
          "speaker": "employee",
          "text": "ACME Support, this is Priya. How can I help?"
        },
        {
          "id": "turn-2",
          "speaker": "customer",
          "text": "I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes."
        },
        {
          "id": "turn-3",
          "speaker": "employee",
          "text": "That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?"
        },
        {
          "id": "turn-4",
          "speaker": "customer",
          "text": "sam.rivera@example.com, and the phone ends in 4417."
        },
        {
          "id": "turn-5",
          "speaker": "employee",
          "text": "Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417."
        },
        { "id": "turn-6", "speaker": "customer", "text": "Got the code and I'm in. Thank you!" }
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
        "turn-1": "Employee: ACME Support, this is Priya. How can I help?",
        "turn-2": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.",
        "turn-3": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?",
        "turn-4": "Customer: sam.rivera@example.com, and the phone ends in 4417.",
        "turn-5": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.",
        "turn-6": "Customer: Got the code and I'm in. Thank you!"
      }
    },
    "score__accuracy": {
      "type": "score",
      "instructions": {
        "task": "Evaluate the employee on Accuracy & policy alignment.",
        "definition": "Gives accurate, internally consistent guidance, follows identity and security verification requirements, and avoids unsupported promises.",
        "guidance": "Judge only behavior supported by this call. Use the full ordered rubric."
      },
      "criteria": [
        "Materially incorrect",
        "Multiple gaps",
        "Mostly accurate",
        "Accurate",
        "Precise and complete"
      ]
    },
    "evidence__accuracy": {
      "type": "choice",
      "instructions": {
        "task": "Which single transcript turn contains the most relevant employee behavior for assessing Accuracy & policy alignment?",
        "definition": "Gives accurate, internally consistent guidance, follows identity and security verification requirements, and avoids unsupported promises.",
        "rubric": [
          "Materially incorrect",
          "Multiple gaps",
          "Mostly accurate",
          "Accurate",
          "Precise and complete"
        ],
        "guidance": "Choose none only when no turn contains relevant employee behavior."
      },
      "criteria": {
        "none": "No transcript turn provides direct evidence for the judgment.",
        "turn-1": "Employee: ACME Support, this is Priya. How can I help?",
        "turn-2": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.",
        "turn-3": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?",
        "turn-4": "Customer: sam.rivera@example.com, and the phone ends in 4417.",
        "turn-5": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.",
        "turn-6": "Customer: Got the code and I'm in. Thank you!"
      }
    },
    "score__resolution": {
      "type": "score",
      "instructions": {
        "task": "Evaluate the employee on Resolution quality.",
        "definition": "Moves the issue to a clear resolution or a well-owned next step.",
        "guidance": "Judge only behavior supported by this call. Use the full ordered rubric."
      },
      "criteria": [
        "Unresolved",
        "Weak next step",
        "Partial resolution",
        "Resolved",
        "Resolved with proactive follow-through"
      ]
    },
    "evidence__resolution": {
      "type": "choice",
      "instructions": {
        "task": "Which single transcript turn contains the most relevant employee behavior for assessing Resolution quality?",
        "definition": "Moves the issue to a clear resolution or a well-owned next step.",
        "rubric": [
          "Unresolved",
          "Weak next step",
          "Partial resolution",
          "Resolved",
          "Resolved with proactive follow-through"
        ],
        "guidance": "Choose none only when no turn contains relevant employee behavior."
      },
      "criteria": {
        "none": "No transcript turn provides direct evidence for the judgment.",
        "turn-1": "Employee: ACME Support, this is Priya. How can I help?",
        "turn-2": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.",
        "turn-3": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?",
        "turn-4": "Customer: sam.rivera@example.com, and the phone ends in 4417.",
        "turn-5": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.",
        "turn-6": "Customer: Got the code and I'm in. Thank you!"
      }
    },
    "score__communication": {
      "type": "score",
      "instructions": {
        "task": "Evaluate the employee on Clear communication.",
        "definition": "Uses concise, understandable language and confirms important details.",
        "guidance": "Judge only behavior supported by this call. Use the full ordered rubric."
      },
      "criteria": [ "Confusing", "Often unclear", "Understandable", "Clear", "Exceptionally clear" ]
    },
    "evidence__communication": {
      "type": "choice",
      "instructions": {
        "task": "Which single transcript turn contains the most relevant employee behavior for assessing Clear communication?",
        "definition": "Uses concise, understandable language and confirms important details.",
        "rubric": [ "Confusing", "Often unclear", "Understandable", "Clear", "Exceptionally clear" ],
        "guidance": "Choose none only when no turn contains relevant employee behavior."
      },
      "criteria": {
        "none": "No transcript turn provides direct evidence for the judgment.",
        "turn-1": "Employee: ACME Support, this is Priya. How can I help?",
        "turn-2": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.",
        "turn-3": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?",
        "turn-4": "Customer: sam.rivera@example.com, and the phone ends in 4417.",
        "turn-5": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.",
        "turn-6": "Customer: Got the code and I'm in. Thank you!"
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
    },
    "signal__emotion": {
      "type": "choice",
      "instructions": {
        "task": "What is the customer's predominant emotional state in the most recent part of the call?",
        "guidance": "Weigh the customer's latest turns most heavily; judge the customer, never the employee."
      },
      "criteria": {
        "frustrated": "Annoyed or exasperated with the employee, the product, or having to repeat themselves.",
        "anxious": "Worried about consequences, under time pressure, or uneasy about risk.",
        "skeptical": "Doubting what the employee has told them, or pressing for proof of a claim.",
        "cooperative": "Engaged and working the problem with the employee, without notable distress.",
        "reassured": "Calm and confident the issue is handled or in good hands.",
        "neutral": "Matter-of-fact exchange with no clear emotional colour."
      }
    }
  }
}
```

</details>

<details>
<summary>Exact response body (212 ms)</summary>

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "score__empathy": {
      "type": "score",
      "score": 2.99,
      "confidence": 0.93,
      "legend": {
        "0": "Dismissive",
        "1": "Minimal acknowledgment",
        "2": "Adequate",
        "3": "Strong",
        "4": "Exceptional"
      },
      "probabilities": { "0": 0, "1": 0, "2": 0.05, "3": 0.91, "4": 0.04 }
    },
    "evidence__empathy": {
      "type": "choice",
      "choice": "turn-3",
      "confidence": 1,
      "probabilities": {
        "none": 0,
        "turn-1": 0,
        "turn-2": 0,
        "turn-3": 1,
        "turn-4": 0,
        "turn-5": 0,
        "turn-6": 0
      }
    },
    "score__accuracy": {
      "type": "score",
      "score": 3.34,
      "confidence": 0.46,
      "legend": {
        "0": "Materially incorrect",
        "1": "Multiple gaps",
        "2": "Mostly accurate",
        "3": "Accurate",
        "4": "Precise and complete"
      },
      "probabilities": { "0": 0, "1": 0.04, "2": 0.07, "3": 0.39, "4": 0.5 }
    },
    "evidence__accuracy": {
      "type": "choice",
      "choice": "turn-5",
      "confidence": 0.91,
      "probabilities": {
        "none": 0,
        "turn-1": 0,
        "turn-2": 0,
        "turn-3": 0.08,
        "turn-4": 0,
        "turn-5": 0.92,
        "turn-6": 0
      }
    },
    "score__resolution": {
      "type": "score",
      "score": 3.2,
      "confidence": 0.82,
      "legend": {
        "0": "Unresolved",
        "1": "Weak next step",
        "2": "Partial resolution",
        "3": "Resolved",
        "4": "Resolved with proactive follow-through"
      },
      "probabilities": { "0": 0, "1": 0, "2": 0, "3": 0.79, "4": 0.21 }
    },
    "evidence__resolution": {
      "type": "choice",
      "choice": "turn-5",
      "confidence": 1,
      "probabilities": {
        "none": 0,
        "turn-1": 0,
        "turn-2": 0,
        "turn-3": 0,
        "turn-4": 0,
        "turn-5": 1,
        "turn-6": 0
      }
    },
    "score__communication": {
      "type": "score",
      "score": 3.8,
      "confidence": 0.83,
      "legend": {
        "0": "Confusing",
        "1": "Often unclear",
        "2": "Understandable",
        "3": "Clear",
        "4": "Exceptionally clear"
      },
      "probabilities": { "0": 0, "1": 0, "2": 0, "3": 0.2, "4": 0.8 }
    },
    "evidence__communication": {
      "type": "choice",
      "choice": "turn-5",
      "confidence": 0.92,
      "probabilities": {
        "none": 0,
        "turn-1": 0,
        "turn-2": 0,
        "turn-3": 0.07,
        "turn-4": 0,
        "turn-5": 0.93,
        "turn-6": 0
      }
    },
    "signal__restated": { "type": "noul", "noul": 0.57 },
    "signal__emotion": {
      "type": "choice",
      "choice": "reassured",
      "confidence": 0.99,
      "probabilities": {
        "frustrated": 0,
        "anxious": 0,
        "skeptical": 0,
        "cooperative": 0.01,
        "reassured": 0.99,
        "neutral": 0
      }
    }
  },
  "usage": { "input_tokens": 2933, "output_tokens": 478 }
}
```

</details>

### OpenAI Decisions request and response

```bash
curl https://api.openai.com/v1/decisions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  --data-binary @docs/provider-examples/openai-request.json
```

The adapter in `apps/api/src/openai-decisions.ts` translates the JEV question set into the Decisions contract. `input` carries the same `state` object as a JSON string, questions become an ordered array with a `name`, question instructions are serialized to strings, score `criteria` become `levels`, and `noul` questions become `predicate` questions with the yes and no descriptions appended to the instructions.

Shape of the fields this app sends and receives. The adapter validates `model`, `answers`, `usage.input_tokens`, and `usage.output_tokens`; the other `usage` fields are as returned in this capture. No refusals occurred here.

```ts
// Request body, as this app sends it
interface DecisionsRequest {
  model: string // "gpt-6-luna"
  input: string // the content to judge; this app sends JSON.stringify(state)
  questions: Question[] // answers come back in the same order
}

type Question =
  | { type: "score"; name: string; instructions: string; levels: { label: string }[] } // ordered; index = score
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: "predicate"; name: string; instructions: string } // yes/no

// Response body
interface DecisionsResponse {
  model: string
  answers: Answer[] // one per question, in question order
  usage: {
    input_tokens: number
    input_tokens_details: { cached_tokens: number; cache_write_tokens: number }
    output_tokens: number
    output_tokens_details: { reasoning_tokens: number }
    total_tokens: number
  }
}

type Answer =
  | {
      type: "score"
      name: string | null
      score: number // expected score; may fall between rubric levels
      confidence: number
      probabilities: { value: number; label: string; probability: number }[]
    }
  | {
      type: "choice"
      name: string | null
      choice: string
      confidence: number
      probabilities: { value: string; probability: number }[]
    }
  | { type: "predicate"; name: string | null; probability: number } // probability of yes
  | { type: "refusal"; name: string | null } // the app fails the scoring request
```

<details>
<summary>Exact request body (all 10 questions)</summary>

```json
{
  "model": "gpt-6-luna",
  "input": "{\"call\":{\"subject\":\"Locked out after password reset\",\"customer_name\":\"Sam Rivera\",\"employee_name\":\"Priya Patel\",\"transcript\":[{\"id\":\"turn-1\",\"speaker\":\"employee\",\"text\":\"ACME Support, this is Priya. How can I help?\"},{\"id\":\"turn-2\",\"speaker\":\"customer\",\"text\":\"I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes.\"},{\"id\":\"turn-3\",\"speaker\":\"employee\",\"text\":\"That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?\"},{\"id\":\"turn-4\",\"speaker\":\"customer\",\"text\":\"sam.rivera@example.com, and the phone ends in 4417.\"},{\"id\":\"turn-5\",\"speaker\":\"employee\",\"text\":\"Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417.\"},{\"id\":\"turn-6\",\"speaker\":\"customer\",\"text\":\"Got the code and I'm in. Thank you!\"}]},\"evaluation_context\":{\"purpose\":\"Quality assurance scorecard for a customer support employee\",\"evidence_rule\":\"Base every judgment only on the supplied transcript\"}}",
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
      "instructions": "{\"task\":\"Which single transcript turn contains the most relevant employee behavior for assessing Empathy & active listening?\",\"definition\":\"Recognizes the customer’s emotion and responds to what they actually said.\",\"rubric\":[\"Dismissive\",\"Minimal acknowledgment\",\"Adequate\",\"Strong\",\"Exceptional\"],\"guidance\":\"Choose none only when no turn contains relevant employee behavior.\"}",
      "choices": [
        {
          "value": "none",
          "description": "No transcript turn provides direct evidence for the judgment."
        },
        {
          "value": "turn-1",
          "description": "Employee: ACME Support, this is Priya. How can I help?"
        },
        {
          "value": "turn-2",
          "description": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes."
        },
        {
          "value": "turn-3",
          "description": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?"
        },
        {
          "value": "turn-4",
          "description": "Customer: sam.rivera@example.com, and the phone ends in 4417."
        },
        {
          "value": "turn-5",
          "description": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417."
        },
        { "value": "turn-6", "description": "Customer: Got the code and I'm in. Thank you!" }
      ]
    },
    {
      "type": "score",
      "name": "score__accuracy",
      "instructions": "{\"task\":\"Evaluate the employee on Accuracy & policy alignment.\",\"definition\":\"Gives accurate, internally consistent guidance, follows identity and security verification requirements, and avoids unsupported promises.\",\"guidance\":\"Judge only behavior supported by this call. Use the full ordered rubric.\"}",
      "levels": [
        { "label": "Materially incorrect" },
        { "label": "Multiple gaps" },
        { "label": "Mostly accurate" },
        { "label": "Accurate" },
        { "label": "Precise and complete" }
      ]
    },
    {
      "type": "choice",
      "name": "evidence__accuracy",
      "instructions": "{\"task\":\"Which single transcript turn contains the most relevant employee behavior for assessing Accuracy & policy alignment?\",\"definition\":\"Gives accurate, internally consistent guidance, follows identity and security verification requirements, and avoids unsupported promises.\",\"rubric\":[\"Materially incorrect\",\"Multiple gaps\",\"Mostly accurate\",\"Accurate\",\"Precise and complete\"],\"guidance\":\"Choose none only when no turn contains relevant employee behavior.\"}",
      "choices": [
        {
          "value": "none",
          "description": "No transcript turn provides direct evidence for the judgment."
        },
        {
          "value": "turn-1",
          "description": "Employee: ACME Support, this is Priya. How can I help?"
        },
        {
          "value": "turn-2",
          "description": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes."
        },
        {
          "value": "turn-3",
          "description": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?"
        },
        {
          "value": "turn-4",
          "description": "Customer: sam.rivera@example.com, and the phone ends in 4417."
        },
        {
          "value": "turn-5",
          "description": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417."
        },
        { "value": "turn-6", "description": "Customer: Got the code and I'm in. Thank you!" }
      ]
    },
    {
      "type": "score",
      "name": "score__resolution",
      "instructions": "{\"task\":\"Evaluate the employee on Resolution quality.\",\"definition\":\"Moves the issue to a clear resolution or a well-owned next step.\",\"guidance\":\"Judge only behavior supported by this call. Use the full ordered rubric.\"}",
      "levels": [
        { "label": "Unresolved" },
        { "label": "Weak next step" },
        { "label": "Partial resolution" },
        { "label": "Resolved" },
        { "label": "Resolved with proactive follow-through" }
      ]
    },
    {
      "type": "choice",
      "name": "evidence__resolution",
      "instructions": "{\"task\":\"Which single transcript turn contains the most relevant employee behavior for assessing Resolution quality?\",\"definition\":\"Moves the issue to a clear resolution or a well-owned next step.\",\"rubric\":[\"Unresolved\",\"Weak next step\",\"Partial resolution\",\"Resolved\",\"Resolved with proactive follow-through\"],\"guidance\":\"Choose none only when no turn contains relevant employee behavior.\"}",
      "choices": [
        {
          "value": "none",
          "description": "No transcript turn provides direct evidence for the judgment."
        },
        {
          "value": "turn-1",
          "description": "Employee: ACME Support, this is Priya. How can I help?"
        },
        {
          "value": "turn-2",
          "description": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes."
        },
        {
          "value": "turn-3",
          "description": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?"
        },
        {
          "value": "turn-4",
          "description": "Customer: sam.rivera@example.com, and the phone ends in 4417."
        },
        {
          "value": "turn-5",
          "description": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417."
        },
        { "value": "turn-6", "description": "Customer: Got the code and I'm in. Thank you!" }
      ]
    },
    {
      "type": "score",
      "name": "score__communication",
      "instructions": "{\"task\":\"Evaluate the employee on Clear communication.\",\"definition\":\"Uses concise, understandable language and confirms important details.\",\"guidance\":\"Judge only behavior supported by this call. Use the full ordered rubric.\"}",
      "levels": [
        { "label": "Confusing" },
        { "label": "Often unclear" },
        { "label": "Understandable" },
        { "label": "Clear" },
        { "label": "Exceptionally clear" }
      ]
    },
    {
      "type": "choice",
      "name": "evidence__communication",
      "instructions": "{\"task\":\"Which single transcript turn contains the most relevant employee behavior for assessing Clear communication?\",\"definition\":\"Uses concise, understandable language and confirms important details.\",\"rubric\":[\"Confusing\",\"Often unclear\",\"Understandable\",\"Clear\",\"Exceptionally clear\"],\"guidance\":\"Choose none only when no turn contains relevant employee behavior.\"}",
      "choices": [
        {
          "value": "none",
          "description": "No transcript turn provides direct evidence for the judgment."
        },
        {
          "value": "turn-1",
          "description": "Employee: ACME Support, this is Priya. How can I help?"
        },
        {
          "value": "turn-2",
          "description": "Customer: I reset my password an hour ago and now the app says my account is locked. I have a client call in twenty minutes."
        },
        {
          "value": "turn-3",
          "description": "Employee: That sounds stressful with a call coming up, so let's get you back in quickly. Can you confirm the email on the account and the last four digits of the phone number?"
        },
        {
          "value": "turn-4",
          "description": "Customer: sam.rivera@example.com, and the phone ends in 4417."
        },
        {
          "value": "turn-5",
          "description": "Employee: Thanks, that matches. Three failed sign-ins after the reset triggered a security lock. I've cleared it, and I'm sending a one-time code to the phone ending 4417."
        },
        { "value": "turn-6", "description": "Customer: Got the code and I'm in. Thank you!" }
      ]
    },
    {
      "type": "predicate",
      "name": "signal__restated",
      "instructions": "{\"task\":\"Did the employee restate or summarise the customer's problem back to them in their own words?\",\"guidance\":\"Judge only the employee's turns in the supplied transcript.\"}\nYes: The employee played the problem back, confirmed their understanding, or summarised the situation for the customer to confirm.\nNo: The employee moved straight to questions, instructions, or a fix without reflecting the problem back."
    },
    {
      "type": "choice",
      "name": "signal__emotion",
      "instructions": "{\"task\":\"What is the customer's predominant emotional state in the most recent part of the call?\",\"guidance\":\"Weigh the customer's latest turns most heavily; judge the customer, never the employee.\"}",
      "choices": [
        {
          "value": "frustrated",
          "description": "Annoyed or exasperated with the employee, the product, or having to repeat themselves."
        },
        {
          "value": "anxious",
          "description": "Worried about consequences, under time pressure, or uneasy about risk."
        },
        {
          "value": "skeptical",
          "description": "Doubting what the employee has told them, or pressing for proof of a claim."
        },
        {
          "value": "cooperative",
          "description": "Engaged and working the problem with the employee, without notable distress."
        },
        {
          "value": "reassured",
          "description": "Calm and confident the issue is handled or in good hands."
        },
        {
          "value": "neutral",
          "description": "Matter-of-fact exchange with no clear emotional colour."
        }
      ]
    }
  ]
}
```

</details>

<details>
<summary>Exact response body (299 ms)</summary>

```json
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
    {
      "type": "score",
      "name": "score__accuracy",
      "score": 3.03,
      "probabilities": [
        { "value": 0, "label": "Materially incorrect", "probability": 0 },
        { "value": 1, "label": "Multiple gaps", "probability": 0.01 },
        { "value": 2, "label": "Mostly accurate", "probability": 0.23 },
        { "value": 3, "label": "Accurate", "probability": 0.48 },
        { "value": 4, "label": "Precise and complete", "probability": 0.28 }
      ],
      "confidence": 0.56
    },
    {
      "type": "choice",
      "name": "evidence__accuracy",
      "choice": "turn-5",
      "probabilities": [
        { "value": "none", "probability": 0.01 },
        { "value": "turn-1", "probability": 0.01 },
        { "value": "turn-2", "probability": 0.01 },
        { "value": "turn-3", "probability": 0.01 },
        { "value": "turn-4", "probability": 0.01 },
        { "value": "turn-5", "probability": 0.95 },
        { "value": "turn-6", "probability": 0 }
      ],
      "confidence": 0.94
    },
    {
      "type": "score",
      "name": "score__resolution",
      "score": 3.13,
      "probabilities": [
        { "value": 0, "label": "Unresolved", "probability": 0 },
        { "value": 1, "label": "Weak next step", "probability": 0 },
        { "value": 2, "label": "Partial resolution", "probability": 0 },
        { "value": 3, "label": "Resolved", "probability": 0.87 },
        { "value": 4, "label": "Resolved with proactive follow-through", "probability": 0.13 }
      ],
      "confidence": 0.89
    },
    {
      "type": "choice",
      "name": "evidence__resolution",
      "choice": "turn-5",
      "probabilities": [
        { "value": "none", "probability": 0 },
        { "value": "turn-1", "probability": 0.01 },
        { "value": "turn-2", "probability": 0 },
        { "value": "turn-3", "probability": 0 },
        { "value": "turn-4", "probability": 0 },
        { "value": "turn-5", "probability": 0.99 },
        { "value": "turn-6", "probability": 0 }
      ],
      "confidence": 0.99
    },
    {
      "type": "score",
      "name": "score__communication",
      "score": 3.17,
      "probabilities": [
        { "value": 0, "label": "Confusing", "probability": 0 },
        { "value": 1, "label": "Often unclear", "probability": 0 },
        { "value": 2, "label": "Understandable", "probability": 0.01 },
        { "value": 3, "label": "Clear", "probability": 0.81 },
        { "value": 4, "label": "Exceptionally clear", "probability": 0.18 }
      ],
      "confidence": 0.84
    },
    {
      "type": "choice",
      "name": "evidence__communication",
      "choice": "turn-5",
      "probabilities": [
        { "value": "none", "probability": 0.01 },
        { "value": "turn-1", "probability": 0 },
        { "value": "turn-2", "probability": 0.01 },
        { "value": "turn-3", "probability": 0.13 },
        { "value": "turn-4", "probability": 0.01 },
        { "value": "turn-5", "probability": 0.83 },
        { "value": "turn-6", "probability": 0.01 }
      ],
      "confidence": 0.8
    },
    { "type": "predicate", "name": "signal__restated", "probability": 0.1 },
    {
      "type": "choice",
      "name": "signal__emotion",
      "choice": "reassured",
      "probabilities": [
        { "value": "frustrated", "probability": 0.03 },
        { "value": "anxious", "probability": 0 },
        { "value": "skeptical", "probability": 0.01 },
        { "value": "cooperative", "probability": 0.17 },
        { "value": "reassured", "probability": 0.78 },
        { "value": "neutral", "probability": 0.01 }
      ],
      "confidence": 0.74
    }
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

</details>

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
