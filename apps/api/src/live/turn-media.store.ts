import { Injectable } from '@nestjs/common';
import type { TurnMedia } from '../scoring/question-plan.js';

// Audio clips and video frames captured for a live session, by turn. They are held in
// memory only for as long as the session is being scored and are never written to the
// database or to disk: the evaluation keeps what the model concluded, not the recording.
@Injectable()
export class TurnMediaStore {
  private readonly sessions = new Map<string, Map<string, TurnMedia>>();

  put(sessionId: string, turnId: string, media: TurnMedia): void {
    const turns = this.sessions.get(sessionId) ?? new Map<string, TurnMedia>();
    turns.set(turnId, { ...turns.get(turnId), ...media });
    this.sessions.set(sessionId, turns);
  }

  // undefined when the session has no media, which tells the scoring engine to skip
  // the media lane entirely.
  get(sessionId: string): Readonly<Record<string, TurnMedia>> | undefined {
    const turns = this.sessions.get(sessionId);
    return turns ? Object.fromEntries(turns) : undefined;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
