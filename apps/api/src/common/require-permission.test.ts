import { ForbiddenException, UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ModuleRef } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { principalOf, REQUIRE_PERMISSION_KEY, RequirePermissionGuard } from "./require-permission";

function contextFor(request: object, permission: string | undefined): { context: ExecutionContext; guard: RequirePermissionGuard; record: ReturnType<typeof vi.fn> } {
  const handler = () => undefined;
  if (permission) Reflect.defineMetadata(REQUIRE_PERMISSION_KEY, permission, handler);
  const record = vi.fn(async () => undefined);
  const moduleRef = { get: () => ({ record }) } as unknown as ModuleRef;
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request })
  } as unknown as ExecutionContext;
  return { context, guard: new RequirePermissionGuard(new Reflector(), moduleRef), record };
}

describe("RequirePermissionGuard", () => {
  it("без метки разрешения пропускает", async () => {
    const { guard, context } = contextFor({}, undefined);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("человек проходит", async () => {
    const { guard, context } = contextFor({ user: { userId: "u1" } }, "tasks.task.create");
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("агент со scope проходит, без scope получает 403 и запись в журнале", async () => {
    const withScope = contextFor({ agent: { scopes: ["tasks:write"] } }, "tasks.task.create");
    await expect(withScope.guard.canActivate(withScope.context)).resolves.toBe(true);
    const without = contextFor({ agent: { scopes: ["tasks:read"] } }, "tasks.task.create");
    await expect(without.guard.canActivate(without.context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(without.record).toHaveBeenCalledWith(expect.anything(), "permission:tasks.task.create", null, 403);
  });

  it("без субъекта — 401", async () => {
    const { guard, context } = contextFor({}, "tasks.task.read");
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("агент приоритетнее user", () => {
    expect(principalOf({ user: { userId: "u" } as never, agent: { scopes: [] } as never })).toEqual({ kind: "agent", scopes: [] });
  });
});
