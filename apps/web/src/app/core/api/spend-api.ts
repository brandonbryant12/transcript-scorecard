import { httpResource } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { SpendSummary } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class SpendApi {
  /** The spending ledger summed across every run. Create it from an injection context. */
  summaryResource() {
    return httpResource<SpendSummary>(() => `${API_URL}/spend`);
  }
}
