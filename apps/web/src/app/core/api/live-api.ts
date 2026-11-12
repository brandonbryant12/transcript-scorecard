import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ControlLiveInput, CreateReplayInput, LiveSessionDetail } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class LiveApi {
  private readonly http = inject(HttpClient);

  createReplay(input: CreateReplayInput): Observable<LiveSessionDetail> {
    return this.http.post<LiveSessionDetail>(`${API_URL}/live`, input);
  }

  get(sessionId: string): Observable<LiveSessionDetail> {
    return this.http.get<LiveSessionDetail>(`${API_URL}/live/${encodeURIComponent(sessionId)}`);
  }

  control(sessionId: string, input: ControlLiveInput): Observable<LiveSessionDetail> {
    return this.http.post<LiveSessionDetail>(
      `${API_URL}/live/${encodeURIComponent(sessionId)}/control`,
      input,
    );
  }

  /** The Server-Sent Events URL that pushes the session after every change. */
  eventsUrl(sessionId: string): string {
    return `${API_URL}/live/${encodeURIComponent(sessionId)}/events`;
  }
}
