import type { SpendTotals } from '../../core/models';
import { SPEND_KIND_LABELS, costShare, formatRate } from './spend-format';

const totals = (estimatedCostUsd: number): SpendTotals => ({
  requests: 1,
  failedRequests: 0,
  questions: 10,
  inputTokens: 1000,
  outputTokens: 0,
  estimatedCostUsd,
});

describe('formatRate', () => {
  it('keeps the third decimal a list price needs', () => {
    expect(formatRate(0.042)).toBe('$0.042');
    expect(formatRate(0.0425)).toBe('$0.0425');
  });

  it('shows at least two decimals', () => {
    expect(formatRate(0.1)).toBe('$0.10');
    expect(formatRate(1.5)).toBe('$1.50');
    expect(formatRate(0)).toBe('$0.00');
  });

  it('shows a dash when there is no price', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(Number.NaN)).toBe('—');
  });
});

describe('costShare', () => {
  it('is the fraction of the total cost', () => {
    expect(costShare(totals(0.25), totals(1))).toBe(0.25);
    expect(costShare(totals(0), totals(1))).toBe(0);
  });

  it('is null when nothing has been spent', () => {
    expect(costShare(totals(0), totals(0))).toBeNull();
  });
});

describe('SPEND_KIND_LABELS', () => {
  it('names every kind of work', () => {
    expect(Object.keys(SPEND_KIND_LABELS)).toEqual(['batch', 'replay', 'stream', 'practice']);
  });
});
