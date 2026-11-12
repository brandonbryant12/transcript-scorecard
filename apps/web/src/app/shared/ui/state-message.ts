import { Component, input } from '@angular/core';

/** A centred loading, empty or error message. Project buttons or links as content. */
@Component({
  selector: 'app-state-message',
  templateUrl: './state-message.html',
  styleUrl: './state-message.css',
})
export class StateMessage {
  readonly kind = input<'loading' | 'empty' | 'error'>('empty');
  readonly title = input.required<string>();
  readonly detail = input<string | null>(null);
}
