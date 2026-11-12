import { Injectable, signal } from '@angular/core';

export interface TurnFocusRequest {
  readonly turnId: string;
  /** Increments on every request, so focusing the same turn twice still scrolls. */
  readonly serial: number;
}

/**
 * Links evidence to the transcript. Anything that cites a turn asks for it to be focused;
 * the transcript scrolls to that turn and highlights it. Provide one per transcript view.
 */
@Injectable()
export class TurnFocus {
  private readonly request = signal<TurnFocusRequest | null>(null);

  readonly focused = this.request.asReadonly();

  focus(turnId: string): void {
    this.request.update((previous) => ({ turnId, serial: (previous?.serial ?? 0) + 1 }));
  }
}
