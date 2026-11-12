import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { RunDetail, RunSummary, StartRunInput } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class RunsApi {
  private readonly http = inject(HttpClient);

  /** Recent scoring runs. Create it from an injection context. */
  listResource() {
    return httpResource<RunSummary[]>(() => `${API_URL}/runs`, { defaultValue: [] });
  }

  start(input: StartRunInput): Observable<RunDetail> {
    return this.http.post<RunDetail>(`${API_URL}/runs`, input);
  }

  get(runId: string): Observable<RunDetail> {
    return this.http.get<RunDetail>(`${API_URL}/runs/${encodeURIComponent(runId)}`);
  }
}
