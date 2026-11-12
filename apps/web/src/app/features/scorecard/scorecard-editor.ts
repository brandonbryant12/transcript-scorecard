import { DatePipe, PercentPipe } from '@angular/common';
import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import {
  FormField,
  applyEach,
  disabled,
  form,
  max,
  maxLength,
  min,
  required,
} from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api/api-error';
import { ScorecardApi } from '../../core/api/scorecard-api';
import type { Channel } from '../../core/models';
import { CHANNEL_LABELS } from '../../core/scoring-labels';
import { StateMessage } from '../../shared/ui/state-message';
import {
  ScorecardFormModel,
  newBehavior,
  toDefinition,
  toFormModel,
  weightShares,
} from './scorecard-form-model';

const CHANNELS: readonly Channel[] = ['verbal', 'vocal', 'visual'];
const EMPTY: ScorecardFormModel = { name: '', description: '', skills: [] };
const NAME_MAX = 80;
const LEVEL_LABEL_MAX = 60;
const TEXT_MAX = 600;

/**
 * Edits the scorecard. Versions are immutable, so saving never changes the version in
 * use: it publishes the next one, and every evaluation and review keeps pointing at the
 * version it was made against.
 */
@Component({
  selector: 'app-scorecard-editor',
  imports: [DatePipe, PercentPipe, FormField, StateMessage],
  templateUrl: './scorecard-editor.html',
  styleUrl: './scorecard-editor.css',
})
export class ScorecardEditor {
  private readonly scorecardApi = inject(ScorecardApi);

  protected readonly scorecard = this.scorecardApi.activeResource();
  protected readonly active = computed(() =>
    this.scorecard.hasValue() ? this.scorecard.value() : null,
  );
  protected readonly loadError = computed(() => {
    const cause = this.scorecard.error();
    return cause ? errorMessage(cause) : null;
  });

  /** The working copy. It restarts from the active version whenever that changes. */
  protected readonly model = linkedSignal<ScorecardFormModel>(() => {
    const active = this.active();
    return active ? toFormModel(active.definition) : EMPTY;
  });
  /** The same limits the API enforces, so most mistakes are caught before publishing. */
  protected readonly editor = form(this.model, (scorecard) => {
    required(scorecard.name, { message: 'The scorecard needs a name' });
    maxLength(scorecard.name, NAME_MAX);
    maxLength(scorecard.description, TEXT_MAX);
    applyEach(scorecard.skills, (skill) => {
      required(skill.name, { message: 'Every skill needs a name' });
      maxLength(skill.name, NAME_MAX);
      required(skill.description, { message: 'Every skill needs a description' });
      maxLength(skill.description, TEXT_MAX);
      min(skill.weight, 0, { message: 'Weights cannot be negative' });
      max(skill.weight, 100, { message: 'A weight cannot exceed 100' });
      applyEach(skill.levels, (level) => {
        required(level.label, { message: 'Every rubric level needs a label' });
        maxLength(level.label, LEVEL_LABEL_MAX);
        required(level.description, { message: 'Every rubric level needs a description' });
        maxLength(level.description, TEXT_MAX);
      });
      applyEach(skill.behaviors, (behavior) => {
        required(behavior.name, { message: 'Every behaviour needs a name' });
        maxLength(behavior.name, NAME_MAX);
        required(behavior.statement, { message: 'Every behaviour needs a statement' });
        maxLength(behavior.statement, TEXT_MAX);
        required(behavior.tip, { message: 'Every behaviour needs a coaching tip' });
        maxLength(behavior.tip, TEXT_MAX);
        maxLength(behavior.expectedWhen, TEXT_MAX);
        // "Expected when" only means something for a behaviour the employee should show;
        // "critical" only for one they should not.
        disabled(behavior.expectedWhen, ({ valueOf }) => valueOf(behavior.polarity) === 'negative');
        disabled(behavior.critical, ({ valueOf }) => valueOf(behavior.polarity) === 'positive');
      });
    });
  });

  protected readonly channels = CHANNELS;
  protected readonly channelLabels = CHANNEL_LABELS;
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly published = signal<number | null>(null);

  protected readonly shares = computed(() => weightShares(this.model()));
  protected readonly changed = computed(() => {
    const active = this.active();
    return (
      active !== null &&
      JSON.stringify(toDefinition(this.model())) !== JSON.stringify(active.definition)
    );
  });

  /** The distinct problems the form currently has, in plain words. */
  protected readonly problems = computed(() => [
    ...new Set(
      this.editor()
        .errorSummary()
        .map((error) => error.message ?? 'A field is not valid'),
    ),
  ]);
  protected readonly canPublish = computed(
    () => this.changed() && !this.saving() && this.problems().length === 0,
  );

  protected shareOf(skillId: string): number {
    return this.shares().get(skillId) ?? 0;
  }

  protected addBehavior(skillIndex: number): void {
    this.updateSkill(skillIndex, (behaviors) => [...behaviors, newBehavior()]);
  }

  protected removeBehavior(skillIndex: number, behaviorIndex: number): void {
    this.updateSkill(skillIndex, (behaviors) =>
      behaviors.filter((_, index) => index !== behaviorIndex),
    );
  }

  protected discard(): void {
    const active = this.active();
    if (active) this.model.set(toFormModel(active.definition));
    this.saveError.set(null);
  }

  protected async publish(): Promise<void> {
    if (!this.canPublish()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.published.set(null);
    try {
      const next = await firstValueFrom(this.scorecardApi.publish(toDefinition(this.model())));
      this.scorecard.set(next);
      this.published.set(next.version);
    } catch (cause) {
      this.saveError.set(errorMessage(cause));
    } finally {
      this.saving.set(false);
    }
  }

  protected reload(): void {
    this.scorecard.reload();
  }

  private updateSkill(
    skillIndex: number,
    change: (
      behaviors: ScorecardFormModel['skills'][number]['behaviors'],
    ) => ScorecardFormModel['skills'][number]['behaviors'],
  ): void {
    this.model.update((model) => ({
      ...model,
      skills: model.skills.map((skill, index) =>
        index === skillIndex ? { ...skill, behaviors: change(skill.behaviors) } : skill,
      ),
    }));
  }
}
