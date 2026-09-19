import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
  MiddlewareConsumer,
  Module,
  NestMiddleware,
  NestModule,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class RequestDiagnostics implements NestMiddleware {
  private readonly logger = new Logger('HttpRequest');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      // Only the registered route template, never a URL, query or parameter value.
      const route =
        typeof req.route?.path === 'string' ? req.route.path : 'unmatched';
      const record = JSON.stringify({
        event: 'http_request_failed',
        requestId,
        method: req.method,
        route,
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      });
      if (res.statusCode >= 500) this.logger.error(record);
      else this.logger.warn(record);
    });
    next();
  }
}

@Catch()
export class SafeHttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    const parserStatus =
      exception instanceof Error && 'statusCode' in exception
        ? exception.statusCode
        : undefined;
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof parserStatus === 'number' &&
            Number.isInteger(parserStatus) &&
            parserStatus >= 400 &&
            parserStatus < 500
          ? parserStatus
          : 500;
    if (status >= 500 || !(exception instanceof HttpException)) {
      response.status(status).json({
        statusCode: status,
        message:
          status >= 500
            ? 'El servicio no está disponible por el momento.'
            : 'Solicitud inválida.',
      });
      return;
    }
    // Preserve validation/authentication contracts; do not log their contents.
    const body = exception.getResponse();
    response
      .status(status)
      .json(
        typeof body === 'string' ? { statusCode: status, message: body } : body,
      );
  }
}

@Module({
  providers: [
    RequestDiagnostics,
    { provide: APP_FILTER, useClass: SafeHttpExceptionFilter },
  ],
})
export class HttpObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestDiagnostics).forRoutes('{*path}');
  }
}
