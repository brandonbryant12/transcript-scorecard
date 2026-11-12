import { DecimalPipe } from '@angular/common';
import { Component, computed, effect, input, signal } from '@angular/core';
import type { LiveSessionDetail } from '../../core/models';
import { providerLabel } from '../../core/provider-meta';
import { UsdPipe } from '../format/usd-pipe';

const TICK_MS = 100;

/** What the scoring cost: provider requests, questions, tokens, latency and estimated spend. */
@Component({
  selector: 'app-telemetry-panel',
  imports: [DecimalPipe, UsdPipe],
  templateUrl: './telemetry-panel.html',
  styleUrl: './telemetry-panel.css',
})
export class TelemetryPanel {
  readonly session = input.required<LiveSessionDetail>();

  protected readonly provider = computed(() => providerLabel(this.session().provider));
  protected readonly model = computed(() => this.session().evaluation?.model ?? null);
  protected readonly failedRequests = computed(
    () => this.session().requests.filter((request) => !request.ok).length,
  );

  private readonly requestStartedAt = computed(() => this.session().requestStartedAt);
  private readonly now = signal(Date.now());

  /** Milliseconds the in-flight request has been running, or null when none is. */
  protected readonly inFlightMs = computed(() => {
    const startedAt = this.requestStartedAt();
    return startedAt === null ? null : Math.max(0, this.now() - Date.parse(startedAt));
  });

  constructor() {
    // Tick only while a request is in flight.
    effect((onCleanup) => {
      if (this.requestStartedAt() === null) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
      onCleanup(() => clearInterval(timer));
    });
  }
}
