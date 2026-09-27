import { CallHandler, ExecutionContext, Injectable, Logger, type NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { Observable } from "rxjs";
import { finalize } from "rxjs/operators";

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger("HTTP");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = request.get("x-request-id") || randomUUID();
    const started = Date.now();
    response.setHeader("x-request-id", requestId);

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(JSON.stringify({
          requestId,
          method: request.method,
          path: request.originalUrl,
          status: response.statusCode,
          durationMs: Date.now() - started
        }));
      })
    );
  }
}
