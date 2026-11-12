import { Pipe, PipeTransform } from '@angular/core';

/** A 0 to 100 score as a whole number, or a dash while there is no score yet. */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || !Number.isFinite(score)) return '—';
  return String(Math.round(score));
}

@Pipe({ name: 'score' })
export class ScorePipe implements PipeTransform {
  transform(score: number | null | undefined): string {
    return formatScore(score);
  }
}
