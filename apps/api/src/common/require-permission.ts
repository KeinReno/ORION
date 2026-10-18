import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, UseGuards } from "@nestjs/common";
import { ModuleRef, Reflector } from "@nestjs/core";
import { isAllowed, type PermissionPrincipal } from "@orion/shared-types";
import type { RequestUser } from "../auth/jwt.strategy";
import type { AgentContext } from "../ai/agent-tokens.service";
import { AgentTokensService } from "../ai/agent-tokens.service";

export const REQUIRE_PERMISSION_KEY = "orion:require-permission";

/**
 * Проверка разрешения из реестра (`packages/shared-types/src/permissions.ts`, PLATFORM_AUDIT G12) на фактической операции.
 * Ставится на метод контроллера РЯДОМ с имеющимися гвардами (`@RequireModule` / `AgentTokenGuard`), а не вместо них:
 * они аутентифицируют и проверяют модуль, этот добавляет «можно ли именно эту операцию».
 * Человек (JWT) — по роли (`ROLE_PERMISSIONS`; сегодня все роли могут всё, членство проверяет сервис),
 * агент — по scope'ам токена через отображение scope → разрешения. Режимы и матрица токена сужают дальше в `runOp`.
 * Отказ — 403 `{ code: "permission_denied", permission }`. Идентичности плагина в запросах пока нет — см. PERMISSIONS.md.
 */
export function RequirePermission(permission: string) {
  return applyDecorators(SetMetadata(REQUIRE_PERMISSION_KEY, permission), UseGuards(RequirePermissionGuard));
}

type PermissionRequest = { user?: RequestUser; agent?: AgentContext };

/** Кто делает запрос: агент приоритетнее (на агентских маршрутах `user` не выставляется, но порядок защищает от подмены). */
export function principalOf(request: PermissionRequest): PermissionPrincipal | null {
  if (request.agent) return { kind: "agent", scopes: request.agent.scopes };
  if (request.user) return { kind: "user" };
  return null;
}

@Injectable()
export class RequirePermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest<PermissionRequest>();
    const principal = principalOf(request);
    if (!principal) throw new UnauthorizedException();
    if (isAllowed(principal, permission)) return true;

    // Отказ агенту попадает в журнал токена так же, как любой другой отказ шлюза.
    if (request.agent) {
      try {
        const tokens = this.moduleRef.get(AgentTokensService, { strict: false });
        await tokens.record(request.agent, `permission:${permission}`, null, 403);
      } catch {
        /* журнал не должен менять ответ */
      }
    }
    throw new ForbiddenException({ code: "permission_denied", permission, message: `Нет разрешения «${permission}»` });
  }
}
