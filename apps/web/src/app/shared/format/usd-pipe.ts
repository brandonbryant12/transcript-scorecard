import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a dollar amount that is usually a fraction of a cent. Amounts under one cent
 * keep enough decimals to show two significant digits instead of rounding to $0.00.
 */
export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (Math.abs(value) >= 0.01) return `$${value.toFixed(2)}`;
  const decimals = Math.min(8, 1 - Math.floor(Math.log10(Math.abs(value))));
  return `$${value.toFixed(decimals)}`;
}

@Pipe({ name: 'usd' })
export class UsdPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    return formatUsd(value);
  }
}
