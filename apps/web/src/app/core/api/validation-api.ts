import { httpResource } from '@angular/common/http';
import { Injectable } from '@angular/core';
import type { ValidationReport } from '../models';
import { API_URL } from './api-url';

@Injectable({ providedIn: 'root' })
export class ValidationApi {
  /** Agreement between AI evaluations and coach reviews. Create it from an injection context. */
  reportResource() {
    return httpResource<ValidationReport>(() => `${API_URL}/validation`);
  }
}
