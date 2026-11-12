import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, Signal, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CallDetail, CallSummary, CallTranscript, ScoringProvider } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class CallsApi {
  private readonly http = inject(HttpClient);

  /** Reactive list of calls. Create it from an injection context. */
  listResource() {
    return httpResource<CallSummary[]>(() => `${API_URL}/calls`, { defaultValue: [] });
  }

  /** Reactive call detail; idle while `callId` is null. */
  detailResource(callId: Signal<string | null>, provider: Signal<ScoringProvider | null>) {
    return httpResource<CallDetail>(() => {
      const id = callId();
      if (id === null) return undefined;
      const chosen = provider();
      return {
        url: `${API_URL}/calls/${encodeURIComponent(id)}`,
        ...(chosen ? { params: { provider: chosen } } : {}),
      };
    });
  }

  get(callId: string): Observable<CallDetail> {
    return this.http.get<CallDetail>(`${API_URL}/calls/${encodeURIComponent(callId)}`);
  }

  /**
   * The transcript on its own. Blind coach review uses this route, whose response carries
   * no evaluation, so the AI's result never reaches the browser before a review is in.
   */
  transcript(callId: string): Observable<CallTranscript> {
    return this.http.get<CallTranscript>(
      `${API_URL}/calls/${encodeURIComponent(callId)}/transcript`,
    );
  }
}
