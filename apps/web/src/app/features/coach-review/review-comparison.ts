import { PercentPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { CoachReview, Evaluation } from '../../core/models';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';

interface ComparisonRow {
  readonly skillId: string;
  readonly name: string;
  readonly coach: string;
  readonly ai: string;
  readonly confidence: number | null;
  /** Level difference, AI minus coach; null when either side has no rating. */
  readonly gap: number | null;
}

/**
 * Shown only after a review is submitted: the coach's level beside the AI's for each
 * skill. Until then the coach has not seen any AI result for the call.
 */
@Component({
  selector: 'app-review-comparison',
  imports: [PercentPipe, ProviderLabelPipe],
  templateUrl: './review-comparison.html',
  styleUrl: './review-comparison.css',
})
export class ReviewComparison {
  readonly review = input.required<CoachReview>();
  readonly evaluation = input.required<Evaluation | null>();

  protected readonly rows = computed<ComparisonRow[]>(() => {
    const evaluation = this.evaluation();
    if (!evaluation) return [];
    const ratings = new Map(this.review().ratings.map((rating) => [rating.skillId, rating.level]));
    return evaluation.skills.map((skill) => {
      const coachLevel = ratings.get(skill.skillId);
      const rated = coachLevel !== undefined && coachLevel !== null;
      const comparable = rated && skill.assessed;
      return {
        skillId: skill.skillId,
        name: skill.name,
        coach: !rated
          ? 'N/A'
          : `${coachLevel} · ${skill.levels[coachLevel]?.label ?? 'unknown level'}`,
        ai: skill.assessed
          ? `${skill.level} · ${skill.levels[skill.level]?.label ?? ''}`
          : 'Not assessed',
        confidence: skill.assessed ? skill.confidence : null,
        gap: comparable ? skill.level - coachLevel : null,
      };
    });
  });

  protected readonly agreed = computed(() => this.rows().filter((row) => row.gap === 0).length);
  protected readonly compared = computed(
    () => this.rows().filter((row) => row.gap !== null).length,
  );
}
