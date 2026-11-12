import { Component, computed, input, model, output } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import type { ScorecardDefinition } from '../../core/models';
import { CHANNEL_LABELS } from '../../core/scoring-labels';
import { NOT_APPLICABLE, ReviewFormModel, ratedSkillCount } from './review-form-model';

/**
 * The coach's rating form, generated from the scorecard: a rubric level (or N/A) and an
 * optional note per skill, and Yes / No / N/A per behaviour.
 */
@Component({
  selector: 'app-review-form',
  imports: [FormField],
  templateUrl: './review-form.html',
  styleUrl: './review-form.css',
})
export class ReviewForm {
  readonly definition = input.required<ScorecardDefinition>();
  /** The form's data. Its entries follow the scorecard's enabled skills, in order. */
  readonly review = model.required<ReviewFormModel>();
  readonly saving = input(false);
  /** Why saving is not possible right now, or null. */
  readonly blockedReason = input<string | null>(null);

  readonly saveDraft = output<void>();
  readonly submitReview = output<void>();

  protected readonly reviewForm = form(this.review);
  protected readonly notApplicable = NOT_APPLICABLE;
  protected readonly channelLabels = CHANNEL_LABELS;

  /** The enabled skills with the positions of their entries in the form's arrays. */
  protected readonly sections = computed(() => {
    let behaviorIndex = 0;
    return this.definition()
      .skills.filter((skill) => skill.enabled && skill.weight > 0)
      .map((skill, skillIndex) => ({
        skill,
        skillIndex,
        behaviors: skill.behaviors.map((behavior) => ({ behavior, index: behaviorIndex++ })),
      }));
  });
  protected readonly ratedCount = computed(() => ratedSkillCount(this.review()));
  protected readonly canSubmit = computed(
    () => !this.saving() && this.blockedReason() === null && this.ratedCount() > 0,
  );
  protected readonly canSave = computed(() => !this.saving() && this.blockedReason() === null);
}
