import {
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { errorMessage } from '../../core/api/api-error';
import { HealthStore } from '../../core/api/health-store';
import { PracticeApi } from '../../core/api/practice-api';
import { BrowserStorage } from '../../core/browser-storage';
import { LiveSessionFollower } from '../../core/live/live-session-follower';
import type { ScoringProvider } from '../../core/models';
import { PROVIDER_META } from '../../core/provider-meta';
import { ProviderSelection } from '../../core/provider-selection';
import { SessionBoard } from '../../shared/session-board/session-board';
import { ProviderPicker } from '../../shared/ui/provider-picker';
import { StateMessage } from '../../shared/ui/state-message';
import { CameraCapture } from './camera-capture';
import { MicCapture } from './mic-capture';
import { PcmPlayer } from './pcm-player';
import { PracticeCall } from './practice-call';
import { PracticeSocket } from './practice-socket';

const AGENT_NAME_KEY = 'scorecard.practice-agent-name';

/**
 * A voice practice call. A real-time voice model plays the customer; the user speaks as
 * the support employee. Both sides are transcribed and fed into a live session, so the
 * conversation is scored and coached exactly like a replayed call.
 */
@Component({
  selector: 'app-practice',
  imports: [SessionBoard, ProviderPicker, StateMessage],
  providers: [
    LiveSessionFollower,
    PracticeCall,
    PracticeSocket,
    MicCapture,
    PcmPlayer,
    CameraCapture,
  ],
  templateUrl: './practice.html',
  styleUrl: './practice.css',
})
export class Practice {
  private readonly practiceApi = inject(PracticeApi);
  private readonly storage = inject(BrowserStorage);
  private readonly health = inject(HealthStore);
  private readonly selection = inject(ProviderSelection);
  private readonly follower = inject(LiveSessionFollower);
  protected readonly call = inject(PracticeCall);

  protected readonly scenarios = this.practiceApi.scenariosResource();
  protected readonly provider = this.selection.provider;
  protected readonly session = this.follower.session;

  protected readonly scenarioList = computed(() =>
    this.scenarios.hasValue() ? this.scenarios.value() : [],
  );
  protected readonly scenarioId = linkedSignal<string | null, string | null>({
    source: () => this.scenarioList()[0]?.id ?? null,
    computation: (first, previous) => previous?.value ?? first,
  });
  protected readonly agentName = signal(this.storage.read(AGENT_NAME_KEY) ?? '');
  protected readonly video = signal(false);

  protected readonly realtime = this.health.realtime;
  /** Why practice calls are unavailable, or null when they can be started. */
  protected readonly unavailable = computed(() => {
    const realtime = this.realtime();
    if (realtime === null) return null;
    return realtime.available
      ? null
      : `${realtime.envVar} is not set on the API server, so the ${realtime.model} voice model that plays the customer is unavailable.`;
  });
  protected readonly inCall = computed(
    () => this.call.phase() === 'connecting' || this.call.phase() === 'live',
  );
  protected readonly canStart = computed(() => {
    const provider = this.provider();
    return (
      !this.inCall() &&
      this.call.phase() !== 'ending' &&
      this.realtime()?.available === true &&
      this.scenarioId() !== null &&
      this.agentName().trim() !== '' &&
      provider !== null &&
      this.health.isConfigured(provider)
    );
  });
  protected readonly readsMedia = computed(() => {
    const provider = this.provider();
    return provider !== null && PROVIDER_META[provider].media;
  });
  protected readonly phaseLabel = computed(() => {
    switch (this.call.phase()) {
      case 'connecting':
        return 'Connecting…';
      case 'live':
        return 'On the call';
      case 'ending':
        return 'Wrapping up…';
      case 'ended':
        return 'Call ended';
      default:
        return 'Not started';
    }
  });
  protected readonly error = computed(() => {
    const listError = this.scenarios.error();
    return (
      this.call.error() ?? this.follower.error() ?? (listError ? errorMessage(listError) : null)
    );
  });

  constructor() {
    // Follow the live session as soon as the service names it.
    effect(() => {
      const sessionId = this.call.sessionId();
      untracked(() => {
        if (sessionId !== null) this.follower.follow(sessionId);
      });
    });

    // A caption is speech in progress. Once its turn lands in the transcript, drop it.
    effect(() => {
      const turnCount = this.session()?.transcript.length ?? 0;
      untracked(() => {
        if (turnCount > 0) this.call.clearCaption();
      });
    });
  }

  protected chooseProvider(provider: ScoringProvider | null): void {
    if (provider !== null) this.selection.select(provider);
  }

  protected selectScenario(scenarioId: string): void {
    this.scenarioId.set(scenarioId);
  }

  protected updateAgentName(name: string): void {
    this.agentName.set(name);
    this.storage.write(AGENT_NAME_KEY, name);
  }

  protected async start(): Promise<void> {
    const scenarioId = this.scenarioId();
    const provider = this.provider();
    if (scenarioId === null || provider === null) return;
    this.follower.clear();
    await this.call.start({
      scenarioId,
      agentName: this.agentName().trim(),
      provider,
      video: this.video(),
    });
  }

  protected end(): void {
    this.call.end();
  }
}
