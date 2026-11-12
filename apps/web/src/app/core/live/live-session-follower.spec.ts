import { TestBed } from '@angular/core/testing';
import type { LiveSessionDetail } from '../models';
import { EVENT_SOURCE_FACTORY, LiveSessionFollower } from './live-session-follower';
import { isSettled, latestSnapshot, parseSnapshot } from './live-session-state';

/** Only the fields the state logic reads; the rest of a session is irrelevant here. */
function snapshot(overrides: Partial<LiveSessionDetail> = {}): LiveSessionDetail {
  return {
    id: 'live-1',
    runId: 'run-1',
    status: 'playing',
    updatedAt: '2026-11-11T10:00:00.000Z',
    revealedTurnCount: 2,
    ...overrides,
  } as LiveSessionDetail;
}

describe('latestSnapshot', () => {
  it('takes the first snapshot', () => {
    const incoming = snapshot();
    expect(latestSnapshot(null, incoming)).toBe(incoming);
  });

  it('keeps the newer of two snapshots of the same run', () => {
    const older = snapshot({ updatedAt: '2026-11-11T10:00:00.000Z', revealedTurnCount: 2 });
    const newer = snapshot({ updatedAt: '2026-11-11T10:00:01.000Z', revealedTurnCount: 3 });
    expect(latestSnapshot(older, newer)).toBe(newer);
    expect(latestSnapshot(newer, older)).toBe(newer);
  });

  it('accepts a snapshot with the same timestamp, so equal-time updates are not lost', () => {
    const current = snapshot();
    const incoming = snapshot({ revealedTurnCount: 3 });
    expect(latestSnapshot(current, incoming)).toBe(incoming);
  });

  it('always switches to a different session or a new run of the same session', () => {
    const current = snapshot({ updatedAt: '2026-11-11T12:00:00.000Z' });
    const reset = snapshot({ runId: 'run-2', updatedAt: '2026-11-11T11:00:00.000Z' });
    const other = snapshot({ id: 'live-2', updatedAt: '2026-11-11T09:00:00.000Z' });
    expect(latestSnapshot(current, reset)).toBe(reset);
    expect(latestSnapshot(current, other)).toBe(other);
  });
});

describe('isSettled', () => {
  it('is true only for completed and failed sessions', () => {
    expect(isSettled(snapshot({ status: 'completed' }))).toBe(true);
    expect(isSettled(snapshot({ status: 'failed' }))).toBe(true);
    expect(isSettled(snapshot({ status: 'playing' }))).toBe(false);
    expect(isSettled(snapshot({ status: 'paused' }))).toBe(false);
  });
});

describe('parseSnapshot', () => {
  it('parses a session and rejects anything else', () => {
    expect(parseSnapshot(JSON.stringify(snapshot()))?.id).toBe('live-1');
    expect(parseSnapshot('not json')).toBeNull();
    expect(parseSnapshot('{"hello":"world"}')).toBeNull();
    expect(parseSnapshot(42)).toBeNull();
  });
});

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  emit(session: LiveSessionDetail): void {
    this.onmessage?.({ data: JSON.stringify(session) } as MessageEvent<unknown>);
  }

  fail(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.();
  }

  close(): void {
    this.closed = true;
  }
}

describe('LiveSessionFollower', () => {
  let follower: LiveSessionFollower;

  beforeEach(() => {
    FakeEventSource.instances.length = 0;
    TestBed.configureTestingModule({
      providers: [
        LiveSessionFollower,
        {
          provide: EVENT_SOURCE_FACTORY,
          useValue: (url: string) => new FakeEventSource(url) as unknown as EventSource,
        },
      ],
    });
    follower = TestBed.inject(LiveSessionFollower);
  });

  const source = () => FakeEventSource.instances.at(-1)!;

  it('opens the session event stream and exposes each pushed snapshot', () => {
    follower.follow('live-1');
    expect(source().url).toBe('/api/live/live-1/events');
    expect(follower.session()).toBeNull();

    source().emit(snapshot({ revealedTurnCount: 4 }));
    expect(follower.session()?.revealedTurnCount).toBe(4);
  });

  it('ignores a pushed snapshot that is older than one already accepted', () => {
    follower.follow('live-1');
    follower.accept(snapshot({ updatedAt: '2026-11-11T10:00:05.000Z', revealedTurnCount: 9 }));
    source().emit(snapshot({ updatedAt: '2026-11-11T10:00:01.000Z', revealedTurnCount: 3 }));
    expect(follower.session()?.revealedTurnCount).toBe(9);
  });

  it('closes the previous stream when following another session', () => {
    follower.follow('live-1');
    const first = source();
    first.emit(snapshot());
    follower.follow('live-2');
    expect(first.closed).toBe(true);
    expect(follower.session()).toBeNull();
    expect(source().url).toBe('/api/live/live-2/events');
  });

  it('treats the stream ending after the session settles as normal', () => {
    follower.follow('live-1');
    source().emit(snapshot({ status: 'completed' }));
    source().fail(2);
    expect(source().closed).toBe(true);
    expect(follower.error()).toBeNull();
  });

  it('reports a stream that closes for good while the session is still live', () => {
    follower.follow('live-1');
    source().emit(snapshot({ status: 'playing' }));
    source().fail(0);
    expect(follower.error()).toBeNull();
    source().fail(2);
    expect(follower.error()).toMatch(/Lost the live connection/);
  });

  it('closes the stream when cleared and when destroyed', () => {
    follower.follow('live-1');
    const first = source();
    follower.clear();
    expect(first.closed).toBe(true);
    expect(follower.session()).toBeNull();

    follower.follow('live-1');
    const second = source();
    TestBed.resetTestingModule();
    expect(second.closed).toBe(true);
  });
});
