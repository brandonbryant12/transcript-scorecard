import type { LiveSessionDetail } from '../models';

/**
 * Decides which of two snapshots of a live session to keep.
 *
 * Snapshots reach the browser two ways: pushed over Server-Sent Events, and returned by
 * control requests. They can arrive out of order, so a snapshot only replaces the current
 * one when it is for a different session or run, or is at least as recent.
 */
export function latestSnapshot(
  current: LiveSessionDetail | null,
  incoming: LiveSessionDetail,
): LiveSessionDetail {
  if (current === null || current.id !== incoming.id || current.runId !== incoming.runId) {
    return incoming;
  }
  return incoming.updatedAt >= current.updatedAt ? incoming : current;
}

/** True once nothing more will happen to the session without the user acting. */
export function isSettled(session: LiveSessionDetail): boolean {
  return session.status === 'completed' || session.status === 'failed';
}

/** Parses one Server-Sent Events payload; null when it is not a session snapshot. */
export function parseSnapshot(data: unknown): LiveSessionDetail | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null && 'id' in parsed && 'status' in parsed) {
      return parsed as LiveSessionDetail;
    }
    return null;
  } catch {
    return null;
  }
}
