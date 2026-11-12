import { Component, computed, input } from '@angular/core';
import type { LiveSessionDetail } from '../../core/models';
import { CoachPanel } from '../coaching/coach-panel';
import { JourneyChart } from '../journey/journey-chart';
import { SkillCard } from '../skills/skill-card';
import { Transcript, TranscriptCaption } from '../transcript/transcript';
import { TurnFocus } from '../transcript/turn-focus';
import { ScoreCard } from './score-card';
import { TelemetryPanel } from './telemetry-panel';

/**
 * Everything known about one live session, coach-first: the transcript on the left with
 * the evidence found in each turn, and on the right the score, the coaching, the customer's
 * journey, each skill and what the scoring cost. Works the same for a replayed call and
 * for a stream whose length is not known yet.
 */
@Component({
  selector: 'app-session-board',
  imports: [Transcript, ScoreCard, CoachPanel, JourneyChart, SkillCard, TelemetryPanel],
  providers: [TurnFocus],
  templateUrl: './session-board.html',
  styleUrl: './session-board.css',
})
export class SessionBoard {
  readonly session = input.required<LiveSessionDetail | null>();
  /** Speech that has been heard but is not a finished turn yet. */
  readonly caption = input<TranscriptCaption | null>(null);
  readonly emptyMessage = input('Turns appear here as the call plays.');
  /** The heading to show before a session exists, such as the chosen call's subject. */
  readonly placeholderTitle = input('No call selected');

  protected readonly evaluation = computed(() => this.session()?.evaluation ?? null);
  protected readonly isLive = computed(() => this.session()?.status === 'playing');

  protected readonly progress = computed(() => {
    const session = this.session();
    if (!session) return null;
    const scored = `${session.scoredTurnCount} scored`;
    return session.totalTurns === null
      ? `${session.revealedTurnCount} turns so far · ${scored}`
      : `${session.revealedTurnCount} of ${session.totalTurns} turns · ${scored}`;
  });

  /** The overall score one pass ago, for the change indicator. */
  protected readonly previousScore = computed(() => {
    const history = this.session()?.history ?? [];
    return history.length > 1 ? history[history.length - 2].overallScore : null;
  });

  /** Each skill's score at every pass in which it could be judged at all. */
  protected readonly skillHistory = computed(() => {
    const series = new Map<string, number[]>();
    for (const point of this.session()?.history ?? []) {
      for (const skill of point.skills) {
        if (skill.observability <= 0) continue;
        const values = series.get(skill.skillId) ?? [];
        values.push(skill.normalizedScore);
        series.set(skill.skillId, values);
      }
    }
    return series;
  });

  protected historyFor(skillId: string): readonly number[] {
    return this.skillHistory().get(skillId) ?? [];
  }
}
