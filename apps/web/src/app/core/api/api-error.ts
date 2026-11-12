import { HttpErrorResponse } from '@angular/common/http';

/** An API failure with a message that is safe and useful to show to the user. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Reads the message out of a NestJS error body (`{ statusCode, message, error }`, where
 * `message` is a string or a list of validation messages) and falls back to something
 * readable when the body is missing or not JSON.
 */
export function apiErrorMessage(status: number, body: unknown): string {
  if (status === 0) return 'The API is not reachable. Check that the server is running.';
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    if (Array.isArray(message)) {
      const parts = message.filter((part): part is string => typeof part === 'string');
      if (parts.length > 0) return parts.join('. ');
    }
  }
  return `Request failed (HTTP ${status})`;
}

export function toApiError(response: HttpErrorResponse): ApiError {
  return new ApiError(apiErrorMessage(response.status, response.error), response.status);
}

/** The text to show for anything a request or resource can fail with. */
export function errorMessage(cause: unknown): string {
  if (cause instanceof HttpErrorResponse) return toApiError(cause).message;
  if (cause instanceof Error && cause.message !== '') return cause.message;
  return 'Something went wrong';
}
