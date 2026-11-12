import {
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api/api-error';
import { CallsApi } from '../../core/api/calls-api';
import { HealthStore } from '../../core/api/health-store';
import { LiveApi } from '../../core/api/live-api';
import { BrowserStorage } from '../../core/browser-storage';
import { LiveSessionFollower } from '../../core/live/live-session-follower';
import type { CallSummary, LiveAction, ScoringProvider } from '../../core/models';
import { ProviderSelection } from '../../core/provider-selection';
import {
  DEFAULT_REVEAL_INTERVAL_MS,
  DEFAULT_SCORE_EVERY_TURNS,
  LIVE_STATUS_LABELS,
  REVEAL_INTERVAL_OPTIONS,
  SCORE_EVERY_TURNS_OPTIONS,
} from '../../core/scoring-labels';
import { DurationPipe } from '../../shared/format/duration-pipe';
import { SessionBoard } from '../../shared/session-board/session-board';
import { ProviderPicker } from '../../shared/ui/provider-picker';

const SESSIONS_KEY = 'scorecard.live-sessions';
const LAST_CALL_KEY = 'scorecard.live-call';

/** Adds the current value to a list of options when it is not one of them. */
function withCurrent(options: readonly number[], current: number): number[] {
  return [...new Set([...options, current])].sort((a, b) => a - b);
}

/**
 * Replays a stored call turn by turn and shows it being scored as it goes. The server
 * owns the replay; this page creates and controls a session and follows it over
 * Server-Sent Events.
 */
@Component({
  selector: 'app-live-studio',
  imports: [SessionBoard, ProviderPicker, DurationPipe],
  providers: [LiveSessionFollower],
  templateUrl: './live-studio.html',
  styleUrl: './live-studio.css',
})
export class LiveStudio {
  private readonly callsApi = inject(CallsApi);
  private readonly liveApi = inject(LiveApi);
  private readonly storage = inject(BrowserStorage);
  private readonly follower = inject(LiveSessionFollower);
  private readonly selection = inject(ProviderSelection);
  private readonly health = inject(HealthStore);

  protected readonly calls = this.callsApi.listResource();
  protected readonly provider = this.selection.provider;
  protected readonly session = this.follower.session;

  protected readonly callList = computed<CallSummary[]>(() =>
    this.calls.hasValue() ? this.calls.value() : [],
  );
  /** The chosen call: the one used last time if it still exists, else the first. */
  protected readonly callId = linkedSignal<CallSummary[], string | null>({
    source: () => this.callList(),
    computation: (calls, previous) => {
      if (previous?.value) return previous.value;
      const last = this.storage.read(LAST_CALL_KEY);
      return calls.find((call) => call.id === last)?.id ?? calls[0]?.id ?? null;
    },
  });
  protected readonly paceMs = signal(DEFAULT_REVEAL_INTERVAL_MS);
  protected readonly scoreEvery = signal(DEFAULT_SCORE_EVERY_TURNS);
  protected readonly busy = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly error = computed(() => {
    const listError = this.calls.error();
    return (
      this.actionError() ?? this.follower.error() ?? (listError ? errorMessage(listError) : null)
    );
  });
  protected readonly selectedCall = computed(
    () => this.callList().find((call) => call.id === this.callId()) ?? null,
  );
  protected readonly paceOptions = computed(() =>
    withCurrent(REVEAL_INTERVAL_OPTIONS, this.paceMs()),
  );
  protected readonly scoreEveryOptions = computed(() =>
    withCurrent(SCORE_EVERY_TURNS_OPTIONS, this.scoreEvery()),
  );
  protected readonly isPlaying = computed(() => this.session()?.status === 'playing');
  protected readonly statusLabel = computed(() => {
    const session = this.session();
    if (!session) return 'Ready';
    return session.status === 'playing' && session.isProcessing
      ? 'Live · scoring'
      : LIVE_STATUS_LABELS[session.status];
  });
  protected readonly startLabel = computed(() => {
    switch (this.session()?.status) {
      case 'paused':
        return 'Resume';
      case 'completed':
      case 'failed':
        return 'Replay again';
      default:
        return 'Start replay';
    }
  });
  protected readonly canStart = computed(() => {
    const provider = this.provider();
    return (
      this.callId() !== null &&
      provider !== null &&
      this.health.isConfigured(provider) &&
      !this.busy() &&
      !this.isPlaying()
    );
  });
  protected readonly progress = computed(() => {
    const session = this.session();
    if (!session || !session.totalTurns) return 0;
    return (session.revealedTurnCount / session.totalTurns) * 100;
  });
  /** How many scoring passes a full replay will take at the current batch size. */
  protected readonly projectedPasses = computed(() => {
    const turns = this.selectedCall()?.turnCount ?? 0;
    return turns === 0 ? null : Math.max(1, Math.ceil(turns / this.scoreEvery()));
  });

  constructor() {
    // Changing the call or the provider switches to that pair's own session, if any.
    effect(() => {
      const callId = this.callId();
      const provider = this.provider();
      untracked(() => void this.switchTo(callId, provider));
    });

    // A newly loaded session owns the pacing controls.
    effect(() => {
      const session = this.session();
      if (!session) return;
      untracked(() => {
        this.paceMs.set(session.revealIntervalMs);
        this.scoreEvery.set(session.scoreEveryTurns);
      });
    });
  }

  protected selectCall(callId: string): void {
    this.callId.set(callId);
    this.storage.write(LAST_CALL_KEY, callId);
  }

  protected chooseProvider(provider: ScoringProvider | null): void {
    if (provider !== null) this.selection.select(provider);
  }

  protected async start(): Promise<void> {
    const callId = this.callId();
    const provider = this.provider();
    if (callId === null || provider === null) return;
    await this.run(async () => {
      let session = this.session();
      if (!session) {
        session = await firstValueFrom(
          this.liveApi.createReplay({
            callId,
            provider,
            intervalMs: this.paceMs(),
            scoreEveryTurns: this.scoreEvery(),
          }),
        );
        this.remember(callId, provider, session.id);
        this.follower.accept(session);
        this.follower.follow(session.id);
      } else if (session.status === 'completed' || session.status === 'failed') {
        this.follower.accept(
          await firstValueFrom(this.liveApi.control(session.id, { action: 'reset' })),
        );
      }
      await this.control(session.id, 'start', true);
    });
  }

  protected async pause(): Promise<void> {
    const session = this.session();
    if (session) await this.run(() => this.control(session.id, 'pause'));
  }

  protected async reset(): Promise<void> {
    const session = this.session();
    if (session) await this.run(() => this.control(session.id, 'reset'));
  }

  protected async changePace(value: string): Promise<void> {
    this.paceMs.set(Number(value));
    await this.applyPacing();
  }

  protected async changeScoreEvery(value: string): Promise<void> {
    this.scoreEvery.set(Number(value));
    await this.applyPacing();
  }

  private async applyPacing(): Promise<void> {
    const session = this.session();
    if (session) await this.run(() => this.control(session.id, 'pace', true), false);
  }

  private async control(sessionId: string, action: LiveAction, withPacing = false): Promise<void> {
    const updated = await firstValueFrom(
      this.liveApi.control(sessionId, {
        action,
        ...(withPacing ? { intervalMs: this.paceMs(), scoreEveryTurns: this.scoreEvery() } : {}),
      }),
    );
    this.follower.accept(updated);
  }

  /** Runs one user action, reporting failure and blocking a second action meanwhile. */
  private async run(action: () => Promise<void>, blocking = true): Promise<void> {
    if (blocking && this.busy()) return;
    if (blocking) this.busy.set(true);
    this.actionError.set(null);
    try {
      await action();
    } catch (cause) {
      this.actionError.set(errorMessage(cause));
    } finally {
      if (blocking) this.busy.set(false);
    }
  }

  private async switchTo(callId: string | null, provider: ScoringProvider | null): Promise<void> {
    const previous = this.session();
    this.actionError.set(null);
    // A replay nobody is watching should not keep spending provider usage.
    if (previous?.status === 'playing') {
      void firstValueFrom(this.liveApi.control(previous.id, { action: 'pause' })).catch(() => {});
    }
    this.follower.clear();
    if (callId === null || provider === null) return;

    const sessionId = this.sessionIds()[this.key(callId, provider)];
    if (!sessionId) return;
    try {
      const restored = await firstValueFrom(this.liveApi.get(sessionId));
      // The selection may have moved on while the request was in flight.
      if (this.callId() !== callId || this.provider() !== provider) return;
      this.follower.accept(restored);
      this.follower.follow(restored.id);
    } catch {
      this.remember(callId, provider, null);
    }
  }

  private key(callId: string, provider: ScoringProvider): string {
    return `${provider}:${callId}`;
  }

  private sessionIds(): Record<string, string> {
    return this.storage.readJson<Record<string, string>>(SESSIONS_KEY, {});
  }

  private remember(callId: string, provider: ScoringProvider, sessionId: string | null): void {
    const ids = this.sessionIds();
    if (sessionId === null) delete ids[this.key(callId, provider)];
    else ids[this.key(callId, provider)] = sessionId;
    this.storage.writeJson(SESSIONS_KEY, ids);
  }
}
