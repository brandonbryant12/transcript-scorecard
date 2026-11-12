import { describe, expect, it } from 'vitest';
import { estimateProviderCostUsd } from './providers.js';
import {
  AppendTurnSchema,
  clampRevealIntervalMs,
  clampScoreEveryTurns,
  ControlLiveSchema,
  CreateReplaySchema,
  DEFAULT_REVEAL_INTERVAL_MS,
  DEFAULT_SCORE_EVERY_TURNS,
  MAX_REVEAL_INTERVAL_MS,
  MAX_SCORE_EVERY_TURNS,
  MIN_REVEAL_INTERVAL_MS,
  MIN_SCORE_EVERY_TURNS,
  StartRunSchema,
} from './records.js';
import { sentimentToValence } from './signals.js';

describe('clampRevealIntervalMs', () => {
  it('keeps a value inside the range, rounded to a whole millisecond', () => {
    expect(clampRevealIntervalMs(1_000)).toBe(1_000);
    expect(clampRevealIntervalMs(333.6)).toBe(334);
  });

  it('clamps to the minimum and maximum', () => {
    expect(clampRevealIntervalMs(10)).toBe(MIN_REVEAL_INTERVAL_MS);
    expect(clampRevealIntervalMs(1_000_000)).toBe(MAX_REVEAL_INTERVAL_MS);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampRevealIntervalMs(Number.NaN)).toBe(DEFAULT_REVEAL_INTERVAL_MS);
    expect(clampRevealIntervalMs(Number.POSITIVE_INFINITY)).toBe(DEFAULT_REVEAL_INTERVAL_MS);
  });
});

describe('clampScoreEveryTurns', () => {
  it('keeps and rounds a value inside the range', () => {
    expect(clampScoreEveryTurns(5)).toBe(5);
    expect(clampScoreEveryTurns(2.4)).toBe(2);
  });

  it('clamps to the minimum and maximum', () => {
    expect(clampScoreEveryTurns(0)).toBe(MIN_SCORE_EVERY_TURNS);
    expect(clampScoreEveryTurns(100)).toBe(MAX_SCORE_EVERY_TURNS);
  });

  it('falls back to the default for a non-finite value', () => {
    expect(clampScoreEveryTurns(Number.NaN)).toBe(DEFAULT_SCORE_EVERY_TURNS);
  });
});

describe('live request schemas', () => {
  it('rejects a reveal interval outside the allowed range', () => {
    expect(CreateReplaySchema.safeParse({ callId: 'c', intervalMs: 100 }).success).toBe(false);
    expect(CreateReplaySchema.safeParse({ callId: 'c', intervalMs: 30_001 }).success).toBe(false);
    expect(CreateReplaySchema.safeParse({ callId: 'c', intervalMs: 250 }).success).toBe(true);
  });

  it('rejects a fractional or out-of-range batch size', () => {
    expect(ControlLiveSchema.safeParse({ action: 'pace', scoreEveryTurns: 1.5 }).success).toBe(
      false,
    );
    expect(ControlLiveSchema.safeParse({ action: 'pace', scoreEveryTurns: 26 }).success).toBe(
      false,
    );
  });

  it('rejects an unknown control action', () => {
    expect(ControlLiveSchema.safeParse({ action: 'rewind' }).success).toBe(false);
  });

  it('trims turn text and rejects a blank turn', () => {
    expect(AppendTurnSchema.parse({ speaker: 'customer', text: '  hello  ' }).text).toBe('hello');
    expect(AppendTurnSchema.safeParse({ speaker: 'customer', text: '   ' }).success).toBe(false);
  });

  it('rejects an unknown provider in a run request', () => {
    expect(StartRunSchema.safeParse({ provider: 'acme' }).success).toBe(false);
    expect(StartRunSchema.safeParse({}).success).toBe(true);
  });
});

describe('sentimentToValence', () => {
  it('maps 0..4 to -1..+1 and clamps beyond', () => {
    expect(sentimentToValence(0)).toBe(-1);
    expect(sentimentToValence(2)).toBe(0);
    expect(sentimentToValence(4)).toBe(1);
    expect(sentimentToValence(6)).toBe(1);
  });
});

describe('estimateProviderCostUsd', () => {
  it('prices input tokens per million', () => {
    expect(estimateProviderCostUsd('gemini', 1_000_000, 0)).toBeCloseTo(0.1);
    expect(estimateProviderCostUsd('jev', 1_000_000, 500)).toBeCloseTo(0.042);
  });
});
