import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ProviderError } from '../decisions/provider.error.js';

// Turns a provider failure raised during a request into an HTTP response in Nest's
// standard error shape. A missing API key is this server's configuration (503); anything
// else is the upstream provider's doing (502).
@Catch(ProviderError)
export class ProviderExceptionFilter implements ExceptionFilter<ProviderError> {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  catch(exception: ProviderError, host: ArgumentsHost): void {
    const statusCode =
      exception.kind === 'not_configured' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
    this.adapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      {
        statusCode,
        message: exception.message,
        error: exception.kind === 'not_configured' ? 'Service Unavailable' : 'Bad Gateway',
      },
      statusCode,
    );
  }
}
