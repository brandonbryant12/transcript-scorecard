import { Component, computed, input } from '@angular/core';
import type { CoachingPoint } from '../../core/models';
import { TurnLink } from '../transcript/turn-link';

const MAX_TURN_LINKS = 3;

/** One strength, opportunity or flag: what it is, the advice, and the turns it came from. */
@Component({
  selector: 'app-coach-point',
  imports: [TurnLink],
  templateUrl: './coach-point.html',
  styleUrl: './coach-point.css',
})
export class CoachPoint {
  readonly point = input.required<CoachingPoint>();

  protected readonly turnIds = computed(() => this.point().turnIds.slice(0, MAX_TURN_LINKS));
  protected readonly moreTurns = computed(() =>
    Math.max(0, this.point().turnIds.length - MAX_TURN_LINKS),
  );
  protected readonly impactNote = computed(() => {
    switch (this.point().impact) {
      case 'sentiment_up':
        return 'Customer sentiment rose right after.';
      case 'sentiment_down':
        return 'Customer sentiment dropped right after.';
      default:
        return null;
    }
  });
}
