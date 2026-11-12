import { Component, computed, inject, input, model } from '@angular/core';
import { HealthStore } from '../../core/api/health-store';
import type { ScoringProvider } from '../../core/models';
import { PROVIDER_META, PROVIDER_ORDER } from '../../core/provider-meta';

/** Segmented control for choosing a scoring provider. Unconfigured providers are disabled. */
@Component({
  selector: 'app-provider-picker',
  templateUrl: './provider-picker.html',
  styleUrl: './provider-picker.css',
})
export class ProviderPicker {
  private readonly health = inject(HealthStore);

  readonly provider = model<ScoringProvider | null>(null);
  readonly disabled = input(false);
  readonly label = input('Scoring provider');

  protected readonly options = computed(() =>
    PROVIDER_ORDER.map((id) => ({
      id,
      label: PROVIDER_META[id].label,
      unavailable: this.health.unavailableReason(id),
    })),
  );

  protected readonly missing = computed(() =>
    this.options()
      .filter((option) => option.unavailable !== null)
      .map((option) => PROVIDER_META[option.id].envVar),
  );
}
