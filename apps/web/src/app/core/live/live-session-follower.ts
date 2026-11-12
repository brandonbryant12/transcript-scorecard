import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { LiveApi } from '../api/live-api';
import type { LiveSessionDetail } from '../models';
import { isSettled, latestSnapshot, parseSnapshot } from './live-session-state';

/** Opens an event stream. A token so tests can substitute a fake `EventSource`. */
export const EVENT_SOURCE_FACTORY = new InjectionToken<(url: string) => EventSource>(
  'EVENT_SOURCE_FACTORY',
  { providedIn: 'root', factory: () => (url: string) => new EventSource(url) },
);

/** `EventSource.CLOSED`: the browser has given up reconnecting. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * Follows one live session over Server-Sent Events and exposes it as a signal.
 *
 * Provide it on the component that shows the session: the stream is closed when that
 * component is destroyed, and each component gets its own.
 */
@Injectable()
export class LiveSessionFollower {
  private readonly api = inject(LiveApi);
  private readonly openEventSource = inject(EVENT_SOURCE_FACTORY);

  private source: EventSource | null = null;
  private readonly snapshot = signal<LiveSessionDetail | null>(null);
  private readonly failure = signal<string | null>(null);

  /** The newest snapshot of the followed session. */
  readonly session = this.snapshot.asReadonly();
  /** Set when the stream is lost for good. */
  readonly error = this.failure.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  /** Starts following a session, or stops following when given null. */
  follow(sessionId: string | null): void {
    this.close();
    this.failure.set(null);
    if (sessionId === null) {
      this.snapshot.set(null);
      return;
    }
    if (this.snapshot()?.id !== sessionId) this.snapshot.set(null);

    const source = this.openEventSource(this.api.eventsUrl(sessionId));
    this.source = source;
    source.onmessage = (event: MessageEvent<unknown>) => {
      const incoming = parseSnapshot(event.data);
      if (incoming) this.accept(incoming);
    };
    source.onerror = () => {
      const current = this.snapshot();
      // The server ends the stream once a session settles; that is not a failure.
      if (current && isSettled(current)) {
        this.close();
      } else if (source.readyState === EVENT_SOURCE_CLOSED) {
        this.failure.set('Lost the live connection to the session.');
      }
      // Otherwise the browser is already reconnecting on its own.
    };
  }

  /** Takes a snapshot from elsewhere, such as the response to a control request. */
  accept(incoming: LiveSessionDetail): void {
    this.snapshot.update((current) => latestSnapshot(current, incoming));
  }

  /** Forgets the session and closes the stream. */
  clear(): void {
    this.close();
    this.snapshot.set(null);
    this.failure.set(null);
  }

  private close(): void {
    this.source?.close();
    this.source = null;
  }
}
