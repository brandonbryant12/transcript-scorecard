import { PercentPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import type { Evaluation, JourneyPoint, Moment, TranscriptTurn } from '../../core/models';
import { sentimentLabel, valenceTone } from '../../core/scoring-labels';
import { DurationPipe } from '../format/duration-pipe';
import { TurnLabelPipe } from '../format/turn-label-pipe';
import { TurnFocus } from './turn-focus';

interface TranscriptRow {
  readonly turn: TranscriptTurn;
  readonly speakerName: string;
  /** Behaviours detected in this employee turn. */
  readonly moments: readonly Moment[];
  /** The customer's sentiment and emotion in this customer turn. */
  readonly feeling: Feeling | null;
}

interface Feeling {
  readonly point: JourneyPoint;
  readonly tone: string;
  readonly words: string;
  /** Set when the turn's audio was read too, so words and voice can be compared. */
  readonly voice: string | null;
}

/** Text that is still being spoken and has not become a turn yet. */
export interface TranscriptCaption {
  readonly speaker: 'employee' | 'customer';
  readonly text: string;
}

const HIGHLIGHT_MS = 2400;

/**
 * A call transcript annotated with what the evaluation found in each turn: detected
 * behaviours on employee turns, sentiment and emotion on customer turns.
 */
@Component({
  selector: 'app-transcript',
  imports: [PercentPipe, DurationPipe, TurnLabelPipe],
  templateUrl: './transcript.html',
  styleUrl: './transcript.css',
})
export class Transcript {
  private readonly turnFocus = inject(TurnFocus, { optional: true });
  private readonly stream = viewChild.required<ElementRef<HTMLElement>>('stream');

  readonly turns = input.required<readonly TranscriptTurn[]>();
  readonly evaluation = input<Evaluation | null>(null);
  readonly agentName = input('Employee');
  readonly customerName = input('Customer');
  /** While true, the view follows the newest turn as it arrives. */
  readonly live = input(false);
  readonly caption = input<TranscriptCaption | null>(null);
  readonly emptyMessage = input('No turns yet.');

  protected readonly highlighted = signal<string | null>(null);
  private highlightTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly rows = computed<TranscriptRow[]>(() => {
    const evaluation = this.evaluation();
    const momentsByTurn = new Map<string, Moment[]>();
    for (const moment of evaluation?.moments ?? []) {
      momentsByTurn.set(moment.turnId, [...(momentsByTurn.get(moment.turnId) ?? []), moment]);
    }
    const points = new Map(
      (evaluation?.journey?.points ?? []).map((point) => [point.turnId, point]),
    );
    return this.turns().map((turn) => {
      const point = points.get(turn.id);
      return {
        turn,
        speakerName: turn.speaker === 'employee' ? this.agentName() : this.customerName(),
        moments: momentsByTurn.get(turn.id) ?? [],
        feeling: point
          ? {
              point,
              tone: valenceTone(point.valence),
              words: sentimentLabel(point.textSentiment),
              voice: point.voiceSentiment === null ? null : sentimentLabel(point.voiceSentiment),
            }
          : null,
      };
    });
  });

  constructor() {
    // Follow the conversation: keep the newest turn or caption in view while live.
    afterRenderEffect(() => {
      const count = this.turns().length;
      const caption = this.caption();
      if (!this.live() || (count === 0 && caption === null)) return;
      const element = this.stream().nativeElement;
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    });

    // Evidence elsewhere on the page points at a turn: bring it into view and mark it.
    afterRenderEffect(() => {
      const request = this.turnFocus?.focused();
      if (!request) return;
      const target = this.stream().nativeElement.querySelector<HTMLElement>(
        `[data-turn-id="${CSS.escape(request.turnId)}"]`,
      );
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.highlighted.set(request.turnId);
      clearTimeout(this.highlightTimer);
      this.highlightTimer = setTimeout(() => this.highlighted.set(null), HIGHLIGHT_MS);
    });
  }
}
