import { Injectable, inject, linkedSignal } from '@angular/core';
import { HealthStore } from './api/health-store';
import { BrowserStorage } from './browser-storage';
import type { ScoringProvider } from './models';
import { PROVIDER_ORDER } from './provider-meta';

const PROVIDER_KEY = 'scorecard.provider';

/**
 * The scoring provider the user is working with, shared across views. It starts at the
 * provider chosen last time when that one is still configured, otherwise at the server's
 * default (the first provider with a key), and follows the user's choice after.
 */
@Injectable({ providedIn: 'root' })
export class ProviderSelection {
  private readonly health = inject(HealthStore);
  private readonly storage = inject(BrowserStorage);

  readonly provider = linkedSignal<ScoringProvider | null, ScoringProvider | null>({
    source: () => this.health.defaultProvider(),
    computation: (fallback, previous) => previous?.value ?? this.remembered() ?? fallback,
  });

  select(provider: ScoringProvider): void {
    this.provider.set(provider);
    this.storage.write(PROVIDER_KEY, provider);
  }

  private remembered(): ScoringProvider | null {
    const stored = this.storage.read(PROVIDER_KEY);
    const provider = PROVIDER_ORDER.find((candidate) => candidate === stored);
    return provider && this.health.isConfigured(provider) ? provider : null;
  }
}
