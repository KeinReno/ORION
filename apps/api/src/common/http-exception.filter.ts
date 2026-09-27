import { ArgumentsHost, Catch, HttpException, HttpStatus, Logger, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.get("x-request-id") || randomUUID();
    const raw = exception instanceof HttpException ? exception.getResponse() : null;
    const message = extractMessage(raw, status);

    if (status >= 500) {
      const detail = exception instanceof Error ? exception.stack ?? exception.message : String(exception);
      this.logger.error(JSON.stringify({ requestId, method: request.method, path: request.originalUrl, status, detail }));
    }

    response.setHeader("x-request-id", requestId);
    response.status(status).json({
      statusCode: status,
      message,
      error: HttpStatus[status] ?? "Error",
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
      // A handler can throw e.g. `new ConflictException({ code: "...",
      // currentRevision, current })` to hand the client structured data
      // beyond a plain message (S11's note CAS conflict is the first use —
      // the editor needs the server's actual current content, not just
      // "conflict"). Anything beyond the reserved keys above rides along;
      // `code` in particular avoids the fixed `error` key above (which is
      // always the HTTP reason phrase, not available for a discriminator).
      ...extraFields(raw)
    });
  }
}

function extractMessage(raw: string | object | null, status: number): string | string[] {
  if (typeof raw === "string") return raw;
  if (raw && "message" in raw) {
    const message = (raw as { message?: unknown }).message;
    if (typeof message === "string" || Array.isArray(message)) return message as string | string[];
  }
  return status >= 500 ? "Внутренняя ошибка сервера" : "Запрос не выполнен";
}

const RESERVED_RESPONSE_KEYS = new Set(["statusCode", "message", "error", "requestId", "timestamp", "path"]);

function extraFields(raw: string | object | null): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!RESERVED_RESPONSE_KEYS.has(key)) out[key] = value;
  }
  return out;
}
