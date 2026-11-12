import { DatePipe, DecimalPipe, NgTemplateOutlet, PercentPipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { errorMessage } from '../../core/api/api-error';
import { SpendApi } from '../../core/api/spend-api';
import type { SpendSummary, SpendTotals } from '../../core/models';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';
import { UsdPipe } from '../../shared/format/usd-pipe';
import { StateMessage } from '../../shared/ui/state-message';
import { SPEND_KIND_LABELS, costShare, formatRate } from './spend-format';

/**
 * The spending ledger: what the decision APIs have cost so far, at what rates, and on
 * which provider, kind of work and day.
 */
@Component({
  selector: 'app-spend',
  imports: [
    DatePipe,
    DecimalPipe,
    NgTemplateOutlet,
    PercentPipe,
    ProviderLabelPipe,
    UsdPipe,
    StateMessage,
  ],
  templateUrl: './spend.html',
  styleUrl: './spend.css',
})
export class Spend {
  private readonly spendApi = inject(SpendApi);

  protected readonly summary = this.spendApi.summaryResource();
  protected readonly kindLabels = SPEND_KIND_LABELS;
  protected readonly rate = formatRate;

  protected readonly data = computed<SpendSummary | null>(() =>
    this.summary.hasValue() ? this.summary.value() : null,
  );
  protected readonly loadError = computed(() => {
    const cause = this.summary.error();
    return cause ? errorMessage(cause) : null;
  });
  protected readonly headline = computed(() => {
    const data = this.data();
    if (!data) return [];
    return [
      { label: 'All time', totals: data.totals.allTime },
      { label: 'Today (UTC)', totals: data.totals.today },
      { label: 'Last 7 days', totals: data.totals.last7Days },
    ];
  });

  protected share(line: SpendTotals): number | null {
    const data = this.data();
    return data ? costShare(line, data.totals.allTime) : null;
  }

  protected reload(): void {
    this.summary.reload();
  }
}
