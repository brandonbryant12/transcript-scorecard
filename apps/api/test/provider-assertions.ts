import { expect } from 'vitest';
import type { ProviderErrorKind } from '../src/decisions/provider.error.js';
import { ProviderError } from '../src/decisions/provider.error.js';

export const API_KEY = 'sk-test-SECRET-key-123';
// Planted in provider response bodies; it must never surface in an error message.
export const BODY_MARKER = 'BODY-MARKER-7f3a';

// Awaits a rejected decision call and checks it failed as a ProviderError of `kind`
// whose public message leaks neither the API key nor anything from the response body.
export const expectProviderError = async (
  promise: Promise<unknown>,
  kind: ProviderErrorKind,
  message?: string | RegExp,
): Promise<ProviderError> => {
  const error = await promise.then(
    () => {
      throw new Error(`Expected a ProviderError of kind "${kind}", but the call succeeded`);
    },
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(ProviderError);
  const providerError = error as ProviderError;
  expect(providerError.kind).toBe(kind);
  expect(providerError.message).not.toContain(API_KEY);
  expect(providerError.message).not.toContain(BODY_MARKER);
  if (message !== undefined) expect(providerError.message).toMatch(message);
  return providerError;
};
