import { HttpClient, httpResource } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { CoachReview, ReviewInput, ReviewQueueItem } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class ReviewsApi {
  private readonly http = inject(HttpClient);

  /** Calls in the order a coach should review them. Create it from an injection context. */
  queueResource() {
    return httpResource<ReviewQueueItem[]>(() => `${API_URL}/reviews/queue`, { defaultValue: [] });
  }

  forCall(callId: string): Observable<CoachReview[]> {
    return this.http.get<CoachReview[]>(`${API_URL}/reviews`, { params: { callId } });
  }

  save(input: ReviewInput): Observable<CoachReview> {
    return this.http.put<CoachReview>(`${API_URL}/reviews`, input);
  }
}
