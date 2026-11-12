import { PercentPipe } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import type { BehaviorResult, SkillResult, TranscriptTurn } from '../../core/models';
import {
  BEHAVIOR_STATUS_LABELS,
  CHANNEL_LABELS,
  CHANNEL_NEEDS,
  scoreTone,
} from '../../core/scoring-labels';
import { ScorePipe } from '../format/score-pipe';
import { TurnLink } from '../transcript/turn-link';
import { Sparkline } from './sparkline';

const MAX_TURN_LINKS = 3;

interface BehaviorView {
  readonly behavior: BehaviorResult;
  readonly statusLabel: string;
  readonly tone: 'good' | 'warn' | 'bad' | 'neutral';
  readonly turnIds: readonly string[];
  readonly moreTurns: number;
  /** What the employee said in the first turn the behaviour was detected in. */
  readonly quote: string | null;
}

function behaviorTone(behavior: BehaviorResult): BehaviorView['tone'] {
  switch (behavior.status) {
    case 'demonstrated':
    case 'clear':
      return 'good';
    case 'missed':
      return 'warn';
    case 'violated':
      return behavior.critical ? 'bad' : 'warn';
    default:
      return 'neutral';
  }
}

/**
 * One skill of the scorecard: its score and rubric level, how sure the model is, how much
 * of its weight counts for this call, and the behaviours behind it with their evidence.
 */
@Component({
  selector: 'app-skill-card',
  imports: [PercentPipe, ScorePipe, TurnLink, Sparkline],
  templateUrl: './skill-card.html',
  styleUrl: './skill-card.css',
})
export class SkillCard {
  readonly skill = input.required<SkillResult>();
  /** The skill's score at each scoring pass so far, oldest first. */
  readonly history = input<readonly number[]>([]);
  /** When given, each detected behaviour quotes the turn it was first seen in. */
  readonly turns = input<readonly TranscriptTurn[] | null>(null);

  protected readonly channelLabel = computed(() => CHANNEL_LABELS[this.skill().channel]);
  protected readonly needs = computed(() => CHANNEL_NEEDS[this.skill().channel]);
  protected readonly tone = computed(() => scoreTone(this.skill().normalizedScore));
  protected readonly levelLabel = computed(() => {
    const skill = this.skill();
    return skill.levels[skill.level]?.label ?? '';
  });
  protected readonly partialWeight = computed(() => this.skill().observability < 0.995);

  protected readonly distribution = computed(() => {
    const skill = this.skill();
    return skill.levels.map((level, index) => ({
      label: level.label,
      description: level.description,
      probability: skill.probabilities[index] ?? 0,
      chosen: index === skill.level,
    }));
  });

  protected readonly behaviors = computed<BehaviorView[]>(() => {
    const text = new Map((this.turns() ?? []).map((turn) => [turn.id, turn.text]));
    return this.skill().behaviors.map((behavior) => ({
      behavior,
      statusLabel: BEHAVIOR_STATUS_LABELS[behavior.status],
      tone: behaviorTone(behavior),
      turnIds: behavior.turnIds.slice(0, MAX_TURN_LINKS),
      moreTurns: Math.max(0, behavior.turnIds.length - MAX_TURN_LINKS),
      quote: behavior.turnIds[0] ? (text.get(behavior.turnIds[0]) ?? null) : null,
    }));
  });
}
