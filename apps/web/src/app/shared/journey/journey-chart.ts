import { Component, computed, inject, input } from '@angular/core';
import type { CustomerJourney, Evaluation } from '../../core/models';
import { ARC_LABELS } from '../../core/scoring-labels';
import { formatTurnLabel } from '../format/turn-label-pipe';
import { TurnFocus } from '../transcript/turn-focus';
import { TurnLink } from '../transcript/turn-link';
import { ChartBox, journeyGeometry } from './journey-geometry';

const BOX: ChartBox = { width: 360, height: 110, padding: 14 };

/**
 * The customer's emotional journey: sentiment per customer turn as a line, the turns
 * where it shifted sharply, the overall arc, and the risk that the customer escalates.
 * It describes the customer; none of it enters the employee's score.
 */
@Component({
  selector: 'app-journey-chart',
  imports: [TurnLink],
  templateUrl: './journey-chart.html',
  styleUrl: './journey-chart.css',
})
export class JourneyChart {
  private readonly turnFocus = inject(TurnFocus, { optional: true });

  readonly journey = input.required<CustomerJourney | null>();
  readonly risk = input<Evaluation['risk']>(null);

  protected readonly box = BOX;
  protected readonly geometry = computed(() => {
    const journey = this.journey();
    return journey ? journeyGeometry(journey, BOX) : null;
  });
  protected readonly arcLabel = computed(() => {
    const journey = this.journey();
    return journey ? ARC_LABELS[journey.arc] : null;
  });
  protected readonly riskTone = computed(() => {
    const level = this.risk()?.level ?? 0;
    return level >= 2 ? 'chip-bad' : level === 1 ? 'chip-warn' : 'chip-good';
  });

  protected describe(turnId: string, emotion: string, valence: number): string {
    const signed = valence > 0 ? `+${valence.toFixed(2)}` : valence.toFixed(2);
    return `${formatTurnLabel(turnId)}: ${emotion}, sentiment ${signed}`;
  }

  protected showTurn(turnId: string): void {
    this.turnFocus?.focus(turnId);
  }
}
