import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { describeDbRoleProblems, type DbRoleRow } from "../src/common/server-config";

/**
 * The server-mode startup guard asks Postgres who the connection is. This pins
 * the query against the real roles from infra/postgres/init/01-app-roles.sql:
 * the application role must pass, the migration superuser must be refused.
 */
const clients: PrismaClient[] = [];

async function roleOf(url: string | undefined): Promise<DbRoleRow | undefined> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  clients.push(client);
  const [row] = await client.$queryRaw<DbRoleRow[]>`SELECT rolname::text AS rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  return row;
}

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
});

describe("server-mode database role guard", () => {
  it("accepts the restricted application role", async () => {
    const row = await roleOf(process.env.APP_DATABASE_URL);
    expect(row?.rolname).toBe("orion_app");
    expect(describeDbRoleProblems(row)).toEqual([]);
  });

  it("refuses the migration superuser, which would bypass FORCE RLS", async () => {
    const row = await roleOf(process.env.DATABASE_URL);
    expect(describeDbRoleProblems(row).join()).toMatch(/суперпользователь|BYPASSRLS/);
  });
});
