import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { ActiveScorecard, ScorecardDefinition } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class ScorecardApi {
  private readonly http = inject(HttpClient);

  /** The active scorecard version. Create it from an injection context. */
  activeResource() {
    return httpResource<ActiveScorecard>(() => `${API_URL}/scorecard`);
  }

  /** Publishes the definition as the next immutable version. */
  publish(definition: ScorecardDefinition): Observable<ActiveScorecard> {
    return this.http.put<ActiveScorecard>(`${API_URL}/scorecard`, definition);
  }
}
