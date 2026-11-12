import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { errorMessage } from '../../core/api/api-error';
import { CallsApi } from '../../core/api/calls-api';
import type { CallStatus, CallSummary } from '../../core/models';
import { scoreTone } from '../../core/scoring-labels';
import { DurationPipe } from '../../shared/format/duration-pipe';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';
import { ScorePipe } from '../../shared/format/score-pipe';
import { StateMessage } from '../../shared/ui/state-message';
import { CallDetailPanel } from './call-detail-panel';

const STATUS_LABELS: Readonly<Record<CallStatus, string>> = {
  pending: 'Not scored',
  processing: 'Scoring',
  completed: 'Scored',
  failed: 'Failed',
};

/** The call library: every call, its latest evaluation, and the evidence behind it. */
@Component({
  selector: 'app-calls',
  imports: [DatePipe, DurationPipe, ProviderLabelPipe, ScorePipe, StateMessage, CallDetailPanel],
  templateUrl: './calls.html',
  styleUrl: './calls.css',
})
export class Calls {
  private readonly router = inject(Router);
  private readonly callsApi = inject(CallsApi);

  /** The open call, bound from the `call` query parameter so a call can be linked to. */
  readonly call = input<string>();

  protected readonly calls = this.callsApi.listResource();
  protected readonly query = signal('');
  protected readonly statusLabels = STATUS_LABELS;

  protected readonly selectedId = computed(() => this.call() ?? null);
  protected readonly loadError = computed(() => {
    const cause = this.calls.error();
    return cause ? errorMessage(cause) : null;
  });
  protected readonly filtered = computed<CallSummary[]>(() => {
    const all = this.calls.hasValue() ? this.calls.value() : [];
    const needle = this.query().trim().toLowerCase();
    if (needle === '') return all;
    return all.filter((call) =>
      `${call.subject} ${call.customerName} ${call.agentName}`.toLowerCase().includes(needle),
    );
  });

  protected tone(call: CallSummary): string {
    return `tone-${scoreTone(call.latest?.overallScore ?? null)}`;
  }

  protected open(callId: string | null): void {
    void this.router.navigate([], { queryParams: { call: callId }, queryParamsHandling: 'merge' });
  }

  protected reload(): void {
    this.calls.reload();
  }
}
