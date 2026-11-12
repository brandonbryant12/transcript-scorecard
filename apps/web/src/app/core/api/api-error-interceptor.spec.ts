import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ApiError, apiErrorMessage, errorMessage } from './api-error';
import { apiErrorInterceptor } from './api-error-interceptor';

describe('apiErrorMessage', () => {
  it('uses the message of a NestJS error body', () => {
    expect(
      apiErrorMessage(404, { statusCode: 404, message: 'Call not found', error: 'Not Found' }),
    ).toBe('Call not found');
  });

  it('joins a list of validation messages', () => {
    const body = {
      statusCode: 400,
      message: ['name: Too small', 'weight: Too big'],
      error: 'Bad Request',
    };
    expect(apiErrorMessage(400, body)).toBe('name: Too small. weight: Too big');
  });

  it('falls back to the status when the body has no usable message', () => {
    expect(apiErrorMessage(502, '<html>Bad gateway</html>')).toBe('Request failed (HTTP 502)');
    expect(apiErrorMessage(500, { message: '' })).toBe('Request failed (HTTP 500)');
    expect(apiErrorMessage(500, null)).toBe('Request failed (HTTP 500)');
  });

  it('explains an unreachable server', () => {
    expect(apiErrorMessage(0, null)).toMatch(/not reachable/);
  });
});

describe('errorMessage', () => {
  it('reads Error instances and tolerates anything else', () => {
    expect(errorMessage(new ApiError('Nope', 400))).toBe('Nope');
    expect(errorMessage('a string')).toBe('Something went wrong');
    expect(errorMessage(undefined)).toBe('Something went wrong');
  });
});

describe('apiErrorInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([apiErrorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  afterEach(() => controller.verify());

  it('turns a failed response into an ApiError carrying the server message', async () => {
    const request = firstValueFrom(http.put('/api/scorecard', {}));
    controller
      .expectOne('/api/scorecard')
      .flush(
        { statusCode: 400, message: ['skills: Too small'], error: 'Bad Request' },
        { status: 400, statusText: 'Bad Request' },
      );

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({ message: 'skills: Too small', status: 400 });
  });

  it('passes successful responses through untouched', async () => {
    const request = firstValueFrom(http.get<{ ok: boolean }>('/api/health'));
    controller.expectOne('/api/health').flush({ ok: true });
    await expect(request).resolves.toEqual({ ok: true });
  });

  it('reports a network failure in plain words', async () => {
    const request = firstValueFrom(http.get('/api/calls'));
    controller.expectOne('/api/calls').error(new ProgressEvent('error'));
    await expect(request).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/not reachable/),
    });
  });
});
