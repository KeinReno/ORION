import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";
import { applyAgentDeleteReason } from "./agent-delete-reason";

/** Runs before route pipes, so `@Body` and `@Query("reason")` both see the mirrored delete reason. */
@Injectable()
export class AgentDeleteReasonInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === "http") applyAgentDeleteReason(context.switchToHttp().getRequest());
    return next.handle();
  }
}
