import {
  PROVIDER_ORDER,
  PROVIDERS,
  SPEND_KINDS,
  type ScoringProvider,
  type SpendKind,
  type SpendKindLine,
  type SpendLedgerRow,
  type SpendPrice,
  type SpendProviderLine,
  type SpendTotals,
} from '@scorecard/domain';

// Pure helpers for the spending summary: day arithmetic, and turning the raw rows SQLite
// returns into the shapes the API serves. The SQL itself lives in SpendService.

// Spending this summary cannot see. The voice model is the one that matters: a practice
// call's own decision-API requests are in the ledger, but the real-time voice model that
// plays the customer is billed separately and its usage is not recorded anywhere.
export const SPEND_EXCLUSIONS: ReadonlyArray<string> = [
  "The practice call's real-time voice model (Gemini Live) is not included; only decision-API requests are recorded.",
  'Requests sent by the provider-examples script are not included; it calls the providers without writing to the ledger.',
];

// SQLite aggregates come back as numbers, but SUM over no rows is NULL, and a driver may
// hand back a numeric string. Anything that is not a finite number counts as zero.
type RawNumber = number | string | null | undefined;

const num = (value: RawNumber): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0;
};

export type RawTotals = { readonly [K in keyof SpendTotals]?: RawNumber };

export const ZERO_TOTALS: SpendTotals = {
  requests: 0,
  failedRequests: 0,
  questions: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0,
};

export const toTotals = (raw: RawTotals | undefined): SpendTotals => ({
  requests: num(raw?.requests),
  failedRequests: num(raw?.failedRequests),
  questions: num(raw?.questions),
  inputTokens: num(raw?.inputTokens),
  outputTokens: num(raw?.outputTokens),
  estimatedCostUsd: num(raw?.estimatedCostUsd),
});

// Days are UTC calendar days. Ledger timestamps are ISO strings in UTC
// (`2026-11-12T07:30:00.000Z`), so a row's day is its first ten characters, and "since the
// start of day D" is a plain string comparison against `D` + `T00:00:00.000Z`. Using UTC
// rather than the server's local zone keeps the boundaries identical on every machine and
// lets SQLite group rows without date functions; it does mean "today" turns over at
// midnight UTC, not local midnight.
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

// The first instant of the UTC day `daysBack` days before `now`'s day, as an ISO string.
export const utcDayStart = (now: Date, daysBack = 0): string =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysBack),
  ).toISOString();

// One line per provider in the picker's order, with zeros for providers never used, so
// the table always reads the same way.
export const providerLines = (
  rows: ReadonlyArray<RawTotals & { readonly provider: string }>,
): SpendProviderLine[] =>
  PROVIDER_ORDER.map((provider: ScoringProvider) => ({
    provider,
    ...toTotals(rows.find((row) => row.provider === provider)),
  }));

export const kindLines = (
  rows: ReadonlyArray<RawTotals & { readonly kind: string }>,
): SpendKindLine[] =>
  SPEND_KINDS.map((kind: SpendKind) => ({
    kind,
    ...toTotals(rows.find((row) => row.kind === kind)),
  }));

export const priceList = (): SpendPrice[] =>
  PROVIDER_ORDER.map((provider) => {
    const info = PROVIDERS[provider];
    return {
      provider,
      label: info.label,
      model: info.model,
      inputUsdPerMillion: info.pricing.inputUsdPerMillion,
      outputUsdPerMillion: info.pricing.outputUsdPerMillion,
      sourceUrl: info.pricing.sourceUrl,
      checkedAt: info.pricing.checkedAt,
    };
  });

export interface RawLedgerRow {
  readonly id: RawNumber;
  readonly startedAt: string;
  readonly runId: string;
  readonly callId: string;
  readonly provider: ScoringProvider;
  readonly model: string | null;
  readonly kind: SpendKind;
  readonly subject: string | null;
  readonly questionCount: RawNumber;
  readonly inputTokens: RawNumber;
  readonly outputTokens: RawNumber;
  readonly latencyMs: RawNumber;
  readonly estimatedCostUsd: RawNumber;
  // SQLite stores booleans as 0 and 1.
  readonly ok: RawNumber | boolean;
}

export const toLedgerRow = (raw: RawLedgerRow): SpendLedgerRow => ({
  id: num(raw.id),
  startedAt: raw.startedAt,
  runId: raw.runId,
  callId: raw.callId,
  provider: raw.provider,
  model: raw.model,
  kind: raw.kind,
  subject: raw.subject,
  questionCount: num(raw.questionCount),
  inputTokens: num(raw.inputTokens),
  outputTokens: num(raw.outputTokens),
  latencyMs: num(raw.latencyMs),
  estimatedCostUsd: num(raw.estimatedCostUsd),
  ok: typeof raw.ok === 'boolean' ? raw.ok : num(raw.ok) === 1,
});
