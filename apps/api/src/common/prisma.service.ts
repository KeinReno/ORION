import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * R29-01 fix: `withGrant` throws this instead of ever invoking its callback
 * when the grant is missing/foreign/expired/revoked. See `withGrant` for why
 * "just run fn under a grant-less RLS context" was the actual bug — an
 * ordinary membership-based policy on the target table can independently
 * make the row visible (e.g. the grantee is *also* a plain member of the
 * source workspace), so a grant-less `fn` is not a safe no-op. Callers
 * (`SharedService`) catch this and turn it into 404, never a distinct
 * error surface a client could use to distinguish "revoked" from "never
 * existed" from "not yours".
 */
export class GrantNotActiveError extends Error {
  constructor() {
    super("Grant is not active");
    this.name = "GrantNotActiveError";
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Connect as orion_app (NOSUPERUSER, NOBYPASSRLS), not the migration-only
    // superuser in DATABASE_URL — see infra/postgres/init/01-app-roles.sql.
    // Falls back to DATABASE_URL only if APP_DATABASE_URL isn't set, so a
    // misconfigured environment fails obviously (via RLS blocking everything)
    // rather than silently running with superuser bypass again.
    const url = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
    super({ datasources: { db: { url } } });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Runs `fn` inside a transaction scoped to `userId` for Postgres RLS:
   * every workspace-owned table (notes, tasks, workspaces,
   * workspace_members) has FORCE ROW LEVEL SECURITY policies that check
   * `current_setting('app.current_user_id', true)`. This is the only way
   * those tables become visible to normal request-serving code — forgetting
   * to route a query through here makes it see nothing, not everything.
   */
  async withUser<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      return fn(tx);
    });
  }

  /**
   * Explicit, auditable RLS bypass for code that legitimately operates
   * across every workspace: the overdue-task cron and the registration
   * bootstrap (which creates a workspace before its first membership row
   * exists, so the normal membership-based policy can't be satisfied yet).
   *
   * Switches to orion_system (NOLOGIN, BYPASSRLS, granted to orion_app) for
   * the duration of the transaction. Note this is *not* `SET LOCAL
   * row_security = off` — that GUC only affects roles already exempt from
   * RLS (superusers/BYPASSRLS), and for every other role it makes RLS-
   * protected queries error out instead of bypassing them. A real bypass
   * requires actually becoming a BYPASSRLS role via SET ROLE.
   */
  async asSystem<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL ROLE orion_system");
      return fn(tx);
    });
  }

  /**
   * U09 (docs/SONNET_IMPLEMENTATION/27-U09-THREAT-MODEL.md) — narrow,
   * transaction-scoped RLS context for reading a single object through an
   * explicit `CrossWorkspaceGrant`. Only `SharedService` calls this — never
   * a normal module service — because the whole point is that
   * `app.active_grant_id` must NOT leak into ordinary `withUser` requests
   * (a second permissive `*_grant_read` policy on e.g. `projects` would
   * otherwise widen visibility for ANY select on that table, not just the
   * grant-aware endpoint — see T4 in the threat model doc).
   *
   * Order matters and is deliberate: `app.current_user_id` is set first (so
   * the caller's own membership-based policies still apply normally inside
   * this same transaction, e.g. for the grant record lookup itself), THEN
   * the grant is verified to exist/be active/belong to `userId` — in code,
   * not just relying on RLS for that first check — and only after that
   * verification passes does this set `app.active_grant_id`, which is what
   * actually unlocks the target object's row via the new grant-read policy.
   * A revoked/expired/foreign grant never reaches the `set_config` call, so
   * `fn` simply sees nothing (RLS still applies with no grant context).
   *
   * `is_local = true` (the third argument) on both `set_config` calls: the
   * GUC lives only for this transaction, never leaks back into the pooled
   * connection after COMMIT/ROLLBACK — the identical guarantee
   * `app.current_user_id` already relies on in `withUser`.
   *
   * R29-01: an inactive grant (missing/foreign/expired/revoked) now throws
   * `GrantNotActiveError` BEFORE `fn` is ever called, instead of calling `fn`
   * under a plain `withUser`-equivalent context. The earlier "just skip
   * setting app.active_grant_id and let fn run anyway" design assumed a
   * grant-less `fn` would see nothing — true only for the grant-read RLS
   * policy in isolation. It ignored that the SAME transaction still carries
   * `app.current_user_id`, so any ordinary membership-based policy on the
   * target table (e.g. the grantee also being a plain member of the source
   * workspace) can independently make the row visible, reopening exactly
   * the access the revoke/expiry was supposed to close. `fn` now only ever
   * runs once the grant has been verified active in code, and receives the
   * already-verified grant row instead of the caller re-querying it (so a
   * second, redundant lookup inside `fn` can't silently diverge from this
   * check or lean on membership-SELECT fallback instead).
   */
  async withGrant<T>(
    grantId: string,
    userId: string,
    fn: (tx: Prisma.TransactionClient, grant: Prisma.CrossWorkspaceGrantGetPayload<Record<string, never>>) => Promise<T>
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
      const grant = await tx.crossWorkspaceGrant.findUnique({ where: { id: grantId } });
      const active =
        grant &&
        grant.granteeUserId === userId &&
        grant.revokedAt === null &&
        (grant.expiresAt === null || grant.expiresAt.getTime() > Date.now());
      if (!active || !grant) {
        // Deliberately do NOT call fn — see class comment above. Callers
        // catch GrantNotActiveError and turn it into a uniform 404.
        throw new GrantNotActiveError();
      }
      await tx.$executeRaw`SELECT set_config('app.active_grant_id', ${grantId}, true)`;
      return fn(tx, grant);
    });
  }
}
