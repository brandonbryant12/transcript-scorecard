import { Injectable } from '@angular/core';

/**
 * localStorage that never throws. Storage can be blocked (private windows, cleared site
 * data), so every read and write is guarded and the app works without it.
 */
@Injectable({ providedIn: 'root' })
export class BrowserStorage {
  read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // Remembering a preference is a convenience; losing it is not an error.
    }
  }

  readJson<T>(key: string, fallback: T): T {
    const raw = this.read(key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  writeJson(key: string, value: unknown): void {
    this.write(key, JSON.stringify(value));
  }
}
