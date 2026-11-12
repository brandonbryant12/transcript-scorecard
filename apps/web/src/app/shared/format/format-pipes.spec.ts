import { DurationPipe, formatDuration } from './duration-pipe';
import { ScorePipe, formatScore } from './score-pipe';
import { TurnLabelPipe, formatTurnLabel } from './turn-label-pipe';
import { UsdPipe, formatUsd } from './usd-pipe';

describe('formatUsd', () => {
  it('keeps two significant digits for amounts under a cent', () => {
    expect(formatUsd(0.0019379)).toBe('$0.0019');
    expect(formatUsd(0.00023)).toBe('$0.00023');
    expect(formatUsd(0.000000042)).toBe('$0.00000004');
  });

  it('uses cents for ordinary amounts', () => {
    expect(formatUsd(0.05)).toBe('$0.05');
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('shows a dash when there is no amount', () => {
    expect(formatUsd(null)).toBe('—');
    expect(formatUsd(undefined)).toBe('—');
    expect(formatUsd(Number.NaN)).toBe('—');
  });

  it('is what the pipe returns', () => {
    expect(new UsdPipe().transform(0.0057)).toBe('$0.0057');
  });
});

describe('formatDuration', () => {
  it('formats seconds as minutes and padded seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('handles missing and negative values', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(-4)).toBe('0:00');
    expect(new DurationPipe().transform(125)).toBe('2:05');
  });
});

describe('formatTurnLabel', () => {
  it('names a turn by its number', () => {
    expect(formatTurnLabel('turn-12')).toBe('Turn 12');
    expect(formatTurnLabel('turn-007')).toBe('Turn 7');
  });

  it('leaves an id with no number as it is', () => {
    expect(formatTurnLabel('opening')).toBe('opening');
    expect(new TurnLabelPipe().transform('turn-3')).toBe('Turn 3');
  });
});

describe('formatScore', () => {
  it('rounds to a whole number and shows a dash for no score', () => {
    expect(formatScore(83.6)).toBe('84');
    expect(formatScore(0)).toBe('0');
    expect(formatScore(null)).toBe('—');
    expect(new ScorePipe().transform(undefined)).toBe('—');
  });
});
