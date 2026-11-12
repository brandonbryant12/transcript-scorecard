import { Injectable } from '@angular/core';
import type { PracticeClientMessage, PracticeServerMessage } from '../../core/models';

const SERVER_EVENTS: ReadonlySet<string> = new Set([
  'ready',
  'audio',
  'interrupted',
  'caption',
  'ended',
  'error',
]);

/** Parses one text frame from the gateway; null when it is not a message we know. */
export function parseServerMessage(data: unknown): PracticeServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'event' in parsed &&
      typeof parsed.event === 'string' &&
      SERVER_EVENTS.has(parsed.event)
    ) {
      return parsed as PracticeServerMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export interface PracticeSocketHandlers {
  readonly onMessage: (message: PracticeServerMessage) => void;
  /** The socket closed, whether we closed it or the server did. */
  readonly onClose: () => void;
}

/** The WebSocket to the practice-call gateway, speaking `{ event, data }` JSON frames. */
@Injectable()
export class PracticeSocket {
  private socket: WebSocket | null = null;

  /** Opens the socket and resolves once it is ready to send. */
  open(url: string, handlers: PracticeSocketHandlers): Promise<void> {
    this.close();
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let opened = false;
      socket.onopen = () => {
        opened = true;
        resolve();
      };
      socket.onmessage = (event: MessageEvent<unknown>) => {
        const message = parseServerMessage(event.data);
        if (message) handlers.onMessage(message);
      };
      socket.onerror = () => {
        if (!opened) reject(new Error('Could not connect to the practice-call service.'));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        if (opened) handlers.onClose();
        else reject(new Error('Could not connect to the practice-call service.'));
      };
    });
  }

  /** Sends a message if the socket is open; drops it otherwise. */
  send(message: PracticeClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
  }
}
