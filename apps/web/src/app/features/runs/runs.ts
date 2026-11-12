import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom, switchMap, takeWhile, timer } from 'rxjs';
import { errorMessage } from '../../core/api/api-error';
import { HealthStore } from '../../core/api/health-store';
import { RunsApi } from '../../core/api/runs-api';
import type { RunDetail, RunStatus, RunSummary, ScoringProvider } from '../../core/models';
import { ProviderSelection } from '../../core/provider-selection';
import { RUN_STATUS_LABELS } from '../../core/scoring-labels';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';
import { ScorePipe } from '../../shared/format/score-pipe';
import { UsdPipe } from '../../shared/format/usd-pipe';
import { ProviderPicker } from '../../shared/ui/provider-picker';
import { StateMessage } from '../../shared/ui/state-message';

const POLL_MS = 1500;

function isActive(status: RunStatus): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * Scoring runs: start a batch over every call, watch it finish, and compare runs by
 * score, cost, latency and agreement with coaches.
 */
@Component({
  selector: 'app-runs',
  imports: [
    DatePipe,
    DecimalPipe,
    PercentPipe,
    ProviderLabelPipe,
    ScorePipe,
    UsdPipe,
    ProviderPicker,
    StateMessage,
  ],
  templateUrl: './runs.html',
  styleUrl: './runs.css',
})
export class Runs {
  private readonly runsApi = inject(RunsApi);
  private readonly selection = inject(ProviderSelection);
  private readonly health = inject(HealthStore);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly runs = this.runsApi.listResource();
  protected readonly provider = this.selection.provider;
  protected readonly statusLabels = RUN_STATUS_LABELS;

  /** The run started from this page, refreshed until it finishes. */
  protected readonly activeRun = signal<RunDetail | null>(null);
  protected readonly starting = signal(false);
  protected readonly actionError = signal<string | null>(null);
  /** Per-call results of the runs the user has expanded. */
  protected readonly expanded = signal<ReadonlyMap<string, RunDetail>>(new Map());
  private polling: Subscription | undefined;

  protected readonly runList = computed<RunSummary[]>(() =>
    this.runs.hasValue() ? this.runs.value() : [],
  );
  protected readonly loadError = computed(() => {
    const cause = this.runs.error();
    return cause ? errorMessage(cause) : null;
  });
  protected readonly running = computed(() => {
    const run = this.activeRun();
    return run !== null && isActive(run.status);
  });
  protected readonly canStart = computed(() => {
    const provider = this.provider();
    return (
      provider !== null && this.health.isConfigured(provider) && !this.starting() && !this.running()
    );
  });
  protected readonly activeProgress = computed(() => {
    const run = this.activeRun();
    return run && run.total > 0 ? (run.completed / run.total) * 100 : 0;
  });

  protected chooseProvider(provider: ScoringProvider | null): void {
    if (provider !== null) this.selection.select(provider);
  }

  protected async startRun(): Promise<void> {
    const provider = this.provider();
    if (provider === null || !this.canStart()) return;
    this.starting.set(true);
    this.actionError.set(null);
    try {
      const run = await firstValueFrom(this.runsApi.start({ provider }));
      this.activeRun.set(run);
      this.follow(run.id);
    } catch (cause) {
      this.actionError.set(errorMessage(cause));
    } finally {
      this.starting.set(false);
    }
  }

  protected async toggle(run: RunSummary): Promise<void> {
    if (this.expanded().has(run.id)) {
      this.expanded.update((open) => {
        const next = new Map(open);
        next.delete(run.id);
        return next;
      });
      return;
    }
    try {
      const detail = await firstValueFrom(this.runsApi.get(run.id));
      this.expanded.update((open) => new Map(open).set(run.id, detail));
    } catch (cause) {
      this.actionError.set(errorMessage(cause));
    }
  }

  protected reload(): void {
    this.runs.reload();
  }

  /** Refetches the run until it leaves the queue, then refreshes the list. */
  private follow(runId: string): void {
    this.polling?.unsubscribe();
    this.polling = timer(POLL_MS, POLL_MS)
      .pipe(
        switchMap(() => this.runsApi.get(runId)),
        takeWhile((run) => isActive(run.status), true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (run) => {
          this.activeRun.set(run);
          if (!isActive(run.status)) this.runs.reload();
        },
        error: (cause: unknown) => this.actionError.set(errorMessage(cause)),
      });
  }
}
