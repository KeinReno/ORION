import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

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
}
