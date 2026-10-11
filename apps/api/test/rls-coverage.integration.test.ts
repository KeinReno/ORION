import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Release gate "Права и RLS" (docs/DEPLOYMENT_READINESS.md), structural half.
 *
 * `api-rls.integration.test.ts` already proves every table with a `workspaceId`
 * column has ENABLE + FORCE RLS and a policy. A table keyed only by `userId`
 * escapes that query, so this one looks at *every* table in `public` and makes
 * the exceptions explicit: a new table without RLS fails here until someone
 * writes down why it may be open.
 */
const WITHOUT_RLS: Record<string, string> = {
  users: "login and register must look up any account before a user context exists (see enable_rls migration); it holds account identity and password hashes, no workspace content",
  refresh_tokens: "AuthService reads and rotates sessions through the plain client, finding rows by token hash before any user context exists; RLS needs those calls moved under asSystem first",
  user_preferences: "SettingsService upserts through the plain client outside withUser; RLS needs those calls moved under withUser first"
};

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

afterAll(async () => {
  await prisma.$disconnect();
});

describe("RLS coverage of the whole public schema", () => {
  it("protects every table except the documented exceptions", async () => {
    const rows = await prisma.$queryRaw<{ table_name: string; rls: boolean; forced: boolean; policies: bigint }[]>`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname
    `;
    expect(rows.length).toBeGreaterThan(40);

    const open = rows.filter((row) => !row.rls || !row.forced || Number(row.policies) === 0).map((row) => row.table_name);
    expect(open.filter((name) => !(name in WITHOUT_RLS))).toEqual([]);
    // An exception that gained protection (or was dropped) must leave the list.
    expect(Object.keys(WITHOUT_RLS).filter((name) => !open.includes(name))).toEqual([]);
  });

  it("keeps the application role unable to bypass or own what RLS protects", async () => {
    const [app] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]>`
      SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'orion_app'
    `;
    expect(app).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });

    // A table owner is exempt from RLS unless FORCE is set; the app role must not own any table at all.
    const owned = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'orion_app'
    `;
    expect(owned).toEqual([]);
  });

  it("limits the system role to what the background jobs need", async () => {
    const [system] = await prisma.$queryRaw<{ rolsuper: boolean; rolcanlogin: boolean }[]>`
      SELECT rolsuper, rolcanlogin FROM pg_roles WHERE rolname = 'orion_system'
    `;
    // `SET LOCAL ROLE orion_system` is how jobs cross workspaces; nobody may log in as it directly.
    expect(system).toEqual({ rolsuper: false, rolcanlogin: false });
  });
});
