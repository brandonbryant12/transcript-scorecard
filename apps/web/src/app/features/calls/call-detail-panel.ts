import { DatePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api/api-error';
import { CallsApi } from '../../core/api/calls-api';
import type { ScoringProvider } from '../../core/models';
import { CoachPanel } from '../../shared/coaching/coach-panel';
import { DurationPipe } from '../../shared/format/duration-pipe';
import { ProviderLabelPipe } from '../../shared/format/provider-label-pipe';
import { ScorePipe } from '../../shared/format/score-pipe';
import { UsdPipe } from '../../shared/format/usd-pipe';
import { JourneyChart } from '../../shared/journey/journey-chart';
import { ScoreCard } from '../../shared/session-board/score-card';
import { SkillCard } from '../../shared/skills/skill-card';
import { Transcript } from '../../shared/transcript/transcript';
import { TurnFocus } from '../../shared/transcript/turn-focus';
import { StateMessage } from '../../shared/ui/state-message';

type DetailTab = 'coaching' | 'scorecard' | 'transcript';

const TABS: readonly { readonly id: DetailTab; readonly label: string }[] = [
  { id: 'coaching', label: 'Coaching' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'transcript', label: 'Transcript' },
];

/** One call's latest evaluation: the coaching, the scorecard with evidence, the transcript. */
@Component({
  selector: 'app-call-detail-panel',
  imports: [
    DatePipe,
    RouterLink,
    DurationPipe,
    ProviderLabelPipe,
    ScorePipe,
    UsdPipe,
    StateMessage,
    ScoreCard,
    CoachPanel,
    JourneyChart,
    SkillCard,
    Transcript,
  ],
  providers: [TurnFocus],
  templateUrl: './call-detail-panel.html',
  styleUrl: './call-detail-panel.css',
})
export class CallDetailPanel {
  private readonly callsApi = inject(CallsApi);
  private readonly turnFocus = inject(TurnFocus);

  readonly callId = input.required<string>();
  readonly closed = output<void>();

  /** Which provider's evaluation to show; null means the most recent one. */
  protected readonly provider = linkedSignal<string, ScoringProvider | null>({
    source: () => this.callId(),
    computation: () => null,
  });
  protected readonly tab = linkedSignal<string, DetailTab>({
    source: () => this.callId(),
    computation: () => 'coaching',
  });
  protected readonly tabs = TABS;

  protected readonly detail = this.callsApi.detailResource(this.callId, this.provider);
  protected readonly call = computed(() => (this.detail.hasValue() ? this.detail.value() : null));
  protected readonly loadError = computed(() => {
    const cause = this.detail.error();
    return cause ? errorMessage(cause) : null;
  });
  protected readonly shownProvider = computed(
    () => this.call()?.evaluation?.provider ?? this.provider(),
  );

  constructor() {
    // Evidence on the coaching and scorecard tabs points into the transcript.
    effect(() => {
      if (this.turnFocus.focused() === null) return;
      untracked(() => this.tab.set('transcript'));
    });
  }

  protected showProvider(provider: ScoringProvider): void {
    this.provider.set(provider);
  }

  protected reload(): void {
    this.detail.reload();
  }
}
