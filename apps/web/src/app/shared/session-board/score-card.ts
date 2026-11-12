import { PercentPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { Evaluation } from '../../core/models';
import { CHANNEL_LABELS, scoreTone } from '../../core/scoring-labels';
import { ScorePipe } from '../format/score-pipe';

/** The headline numbers of one evaluation: score, how much of the scorecard it covers, and how sure. */
@Component({
  selector: 'app-score-card',
  imports: [PercentPipe, ScorePipe],
  templateUrl: './score-card.html',
  styleUrl: './score-card.css',
})
export class ScoreCard {
  readonly evaluation = input.required<Evaluation | null>();
  /** The overall score of the pass before this one, for the change indicator. */
  readonly previousScore = input<number | null>(null);
  /** True while a scoring request is in flight. */
  readonly processing = input(false);

  protected readonly tone = computed(() => scoreTone(this.evaluation()?.overallScore ?? null));
  protected readonly channels = computed(() =>
    (this.evaluation()?.channels ?? []).map((channel) => CHANNEL_LABELS[channel]),
  );
  protected readonly change = computed(() => {
    const current = this.evaluation()?.overallScore ?? null;
    const previous = this.previousScore();
    if (current === null || previous === null) return null;
    const delta = Math.round((current - previous) * 10) / 10;
    return { delta, text: `${delta > 0 ? '+' : ''}${delta.toFixed(1)} since the last pass` };
  });
  protected readonly flagCount = computed(() => this.evaluation()?.coaching.flags.length ?? 0);
}
