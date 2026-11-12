import { vi } from 'vitest';
import type { Fetch } from '../src/decisions/adapters/adapter-support.js';

// One request as an adapter sent it, decoded for assertions.
export interface CapturedRequest {
  readonly url: string;
  readonly method: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
  readonly body: any;
  readonly signal: AbortSignal | null | undefined;
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const textResponse = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

// A stand-in for the FETCH token: records every request and answers with `respond`.
// It never touches the network.
export const scriptedFetch = (
  respond: (request: CapturedRequest) => Response | Promise<Response>,
): { readonly fetch: Fetch; readonly requests: CapturedRequest[] } => {
  const requests: CapturedRequest[] = [];
  const fetch = vi.fn(async (input: Parameters<Fetch>[0], init?: RequestInit) => {
    const rawBody = typeof init?.body === 'string' ? init.body : '';
    const request: CapturedRequest = {
      url: String(input),
      method: init?.method,
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      rawBody,
      body: rawBody ? JSON.parse(rawBody) : undefined,
      signal: init?.signal,
    };
    requests.push(request);
    return respond(request);
  });
  return { fetch: fetch as unknown as Fetch, requests };
};

// A fetch that fails the way the platform does, before any response arrives.
export const failingFetch = (error: unknown): Fetch =>
  vi.fn(async () => {
    throw error;
  }) as unknown as Fetch;
