import { Component, inject, input } from '@angular/core';
import { TurnLabelPipe } from '../format/turn-label-pipe';
import { TurnFocus } from './turn-focus';

/** A reference to one transcript turn. Clicking it brings that turn into view. */
@Component({
  selector: 'app-turn-link',
  imports: [TurnLabelPipe],
  template: `
    <button type="button" class="turn-link" (click)="showTurn()">
      {{ turnId() | turnLabel }}
    </button>
  `,
  styleUrl: './turn-link.css',
})
export class TurnLink {
  private readonly turnFocus = inject(TurnFocus, { optional: true });

  readonly turnId = input.required<string>();

  protected showTurn(): void {
    this.turnFocus?.focus(this.turnId());
  }
}
