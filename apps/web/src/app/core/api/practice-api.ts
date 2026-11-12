import { httpResource } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { PracticeScenario } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class PracticeApi {
  /** The practice scenarios on offer. Create it from an injection context. */
  scenariosResource() {
    return httpResource<PracticeScenario[]>(() => `${API_URL}/practice/scenarios`, {
      defaultValue: [],
    });
  }

  /** The WebSocket URL of the practice-call gateway, on the page's own origin. */
  socketUrl(): string {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}${API_URL}/practice`;
  }
}
