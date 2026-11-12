import { httpResource } from '@angular/common/http';
import { Injectable, computed } from '@angular/core';
import type { HealthStatus, ScoringProvider } from '../models';
import { PROVIDER_META } from '../provider-meta';
import { API_URL } from './api-url';

/** Which providers the server can reach. Loaded once and shared by the whole app. */
@Injectable({ providedIn: 'root' })
export class HealthStore {
  private readonly health = httpResource<HealthStatus>(() => `${API_URL}/health`);

  readonly status = computed<HealthStatus | null>(() =>
    this.health.hasValue() ? this.health.value() : null,
  );
  readonly error = computed(() => this.health.error() ?? null);
  readonly defaultProvider = computed<ScoringProvider | null>(
    () => this.status()?.defaultProvider ?? null,
  );
  readonly realtime = computed(() => this.status()?.realtime ?? null);

  isConfigured(provider: ScoringProvider): boolean {
    return this.status()?.providers[provider] ?? false;
  }

  /** Why a provider cannot be picked, or null when it can. */
  unavailableReason(provider: ScoringProvider): string | null {
    if (this.status() === null || this.isConfigured(provider)) return null;
    return `${PROVIDER_META[provider].envVar} is not set on the API server`;
  }

  reload(): void {
    this.health.reload();
  }
}
