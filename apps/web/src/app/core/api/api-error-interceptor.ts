import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { toApiError } from './api-error';

/** Replaces transport errors with an `ApiError` carrying the server's own message. */
export const apiErrorInterceptor: HttpInterceptorFn = (request, next) =>
  next(request).pipe(
    catchError((cause: unknown) =>
      throwError(() => (cause instanceof HttpErrorResponse ? toApiError(cause) : cause)),
    ),
  );
