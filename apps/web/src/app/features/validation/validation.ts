import { DecimalPipe, PercentPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api/api-error';
import { ValidationApi } from '../../core/api/validation-api';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';
import { StateMessage } from '../../shared/ui/state-message';

/** Says in words which way the AI leans relative to coaches. */
export function describeBias(bias: number, unit: string): string {
  const size = Math.abs(bias);
  if (size < 0.05) return 'the AI is in line with coaches on average';
  const direction = bias > 0 ? 'more lenient' : 'stricter';
  return `the AI is ${direction} than coaches by ${size.toFixed(2)} ${unit} on average`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const METRIC_NOTES: readonly { readonly term: string; readonly meaning: string }[] = [
  {
    term: 'Exact agreement',
    meaning: 'The share of rated skills where the AI chose the same rubric level as the coach.',
  },
  {
    term: 'Within one level',
    meaning: 'The share where the AI was on the same level or the one next to it.',
  },
  {
    term: 'MAE',
    meaning:
      'Mean absolute error: how far the AI is from the coach on average, in rubric levels (or score points for the overall score).',
  },
  {
    term: 'Bias',
    meaning:
      'The average signed difference. Positive means the AI rates higher than coaches; negative, lower.',
  },
  {
    term: 'Weighted kappa',
    meaning:
      'Agreement corrected for chance, where a miss of two levels costs four times a miss of one. 1 is perfect, 0 is no better than chance.',
  },
  {
    term: 'Behaviour precision and recall',
    meaning:
      'Precision: of the behaviours the AI said happened, the share the coach also saw. Recall: of those the coach saw, the share the AI found.',
  },
  {
    term: 'Calibration',
    meaning:
      'In each confidence band, how often the AI was exactly right. A calibrated model is right about as often as it says it is.',
  },
  {
    term: 'Human baseline',
    meaning:
      'How much two coaches agree with each other on the same call: the ceiling the AI can reasonably be held to.',
  },
];

/** Agreement between AI evaluations and coach reviews of the same calls. */
@Component({
  selector: 'app-validation',
  imports: [DecimalPipe, PercentPipe, RouterLink, ProviderLabelPipe, StateMessage],
  templateUrl: './validation.html',
  styleUrl: './validation.css',
})
export class Validation {
  private readonly validationApi = inject(ValidationApi);

  protected readonly report = this.validationApi.reportResource();
  protected readonly metricNotes = METRIC_NOTES;

  protected readonly data = computed(() => (this.report.hasValue() ? this.report.value() : null));
  protected readonly loadError = computed(() => {
    const cause = this.report.error();
    return cause ? errorMessage(cause) : null;
  });

  protected levelBias(bias: number): string {
    return capitalise(describeBias(bias, 'levels'));
  }

  protected scoreBias(bias: number): string {
    return describeBias(bias, 'points');
  }

  protected reload(): void {
    this.report.reload();
  }
}
