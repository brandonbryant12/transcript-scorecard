import type { SpendKind, SpendTotals } from '../../core/models';

/** What each kind of work is called on the page, for a breakdown line or a single request. */
export const SPEND_KIND_LABELS: Readonly<Record<SpendKind, string>> = {
  batch: 'Batch run',
  replay: 'Live replay',
  stream: 'Stream',
  practice: 'Practice call',
};

/**
 * A list price in dollars per million tokens. Prices like $0.042 need a third decimal,
 * which the general dollar format rounds away, so this keeps up to four decimals and
 * never fewer than two.
 */
export function formatRate(usdPerMillion: number | null | undefined): string {
  if (usdPerMillion === null || usdPerMillion === undefined || !Number.isFinite(usdPerMillion))
    return '—';
  const fixed = usdPerMillion.toFixed(4).replace(/0{1,2}$/, '');
  return `$${fixed}`;
}

/** This line's share of the total estimated cost, or null when nothing has been spent. */
export function costShare(line: SpendTotals, total: SpendTotals): number | null {
  return total.estimatedCostUsd > 0 ? line.estimatedCostUsd / total.estimatedCostUsd : null;
}
