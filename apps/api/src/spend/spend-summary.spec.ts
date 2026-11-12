import { PROVIDERS } from '@scorecard/domain';
import {
  kindLines,
  priceList,
  providerLines,
  toLedgerRow,
  toTotals,
  utcDay,
  utcDayStart,
  ZERO_TOTALS,
  type RawLedgerRow,
} from './spend-summary.js';

describe('UTC day boundaries', () => {
  it('names the UTC day, not the local one', () => {
    expect(utcDay(new Date('2026-11-12T23:59:59.999Z'))).toBe('2026-11-12');
    expect(utcDay(new Date('2026-11-13T00:00:00.000Z'))).toBe('2026-11-13');
  });

  it('starts a day at midnight UTC and counts back whole days across a month end', () => {
    const now = new Date('2026-03-02T15:30:00.000Z');
    expect(utcDayStart(now)).toBe('2026-03-02T00:00:00.000Z');
    expect(utcDayStart(now, 6)).toBe('2026-02-24T00:00:00.000Z');
  });

  it('compares with ledger timestamps as plain strings', () => {
    const start = utcDayStart(new Date('2026-11-12T08:00:00.000Z'));
    expect('2026-11-12T00:00:00.000Z' >= start).toBe(true);
    expect('2026-11-11T23:59:59.999Z' >= start).toBe(false);
  });
});

describe('toTotals', () => {
  it('reads SQLite aggregates, including numeric strings', () => {
    expect(
      toTotals({
        requests: 3,
        failedRequests: '1',
        questions: 120,
        inputTokens: 2000,
        outputTokens: 20,
        estimatedCostUsd: 0.000084,
      }),
    ).toEqual({
      requests: 3,
      failedRequests: 1,
      questions: 120,
      inputTokens: 2000,
      outputTokens: 20,
      estimatedCostUsd: 0.000084,
    });
  });

  it('treats a missing row or NULL sums as zero', () => {
    expect(toTotals(undefined)).toEqual(ZERO_TOTALS);
    expect(toTotals({ requests: 0, inputTokens: null, estimatedCostUsd: 'NaN' })).toEqual(
      ZERO_TOTALS,
    );
  });
});

describe('breakdown lines', () => {
  it('lists every provider in picker order, with zeros for unused ones', () => {
    const lines = providerLines([{ provider: 'jev', requests: 2, inputTokens: 2000 }]);
    expect(lines.map((line) => line.provider)).toEqual(['gemini', 'openai', 'jev']);
    expect(lines[0]).toEqual({ provider: 'gemini', ...ZERO_TOTALS });
    expect(lines[2]).toMatchObject({ provider: 'jev', requests: 2, inputTokens: 2000 });
  });

  it('lists every kind of work in a fixed order', () => {
    const lines = kindLines([
      { kind: 'practice', requests: 4 },
      { kind: 'batch', requests: 9 },
    ]);
    expect(lines.map((line) => [line.kind, line.requests])).toEqual([
      ['batch', 9],
      ['replay', 0],
      ['stream', 0],
      ['practice', 4],
    ]);
  });
});

describe('priceList', () => {
  it('is the provider price table, in picker order', () => {
    expect(priceList()).toEqual(
      (['gemini', 'openai', 'jev'] as const).map((provider) => ({
        provider,
        label: PROVIDERS[provider].label,
        model: PROVIDERS[provider].model,
        inputUsdPerMillion: PROVIDERS[provider].pricing.inputUsdPerMillion,
        outputUsdPerMillion: PROVIDERS[provider].pricing.outputUsdPerMillion,
        sourceUrl: PROVIDERS[provider].pricing.sourceUrl,
        checkedAt: PROVIDERS[provider].pricing.checkedAt,
      })),
    );
  });
});

describe('toLedgerRow', () => {
  const raw: RawLedgerRow = {
    id: 7,
    startedAt: '2026-11-12T07:00:00.000Z',
    runId: 'run-1',
    callId: 'call-1',
    provider: 'openai',
    model: null,
    kind: 'batch',
    subject: 'Refund',
    questionCount: 40,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 120,
    estimatedCostUsd: 0,
    ok: 0,
  };

  it('turns SQLite 0 and 1 into a boolean', () => {
    expect(toLedgerRow(raw).ok).toBe(false);
    expect(toLedgerRow({ ...raw, ok: 1 }).ok).toBe(true);
    expect(toLedgerRow({ ...raw, ok: true }).ok).toBe(true);
  });

  it('keeps a failed row with no model and no cost', () => {
    expect(toLedgerRow(raw)).toMatchObject({ model: null, estimatedCostUsd: 0, latencyMs: 120 });
  });
});
