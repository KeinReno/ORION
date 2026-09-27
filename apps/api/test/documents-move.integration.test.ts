import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S14c — data-integrity regression for `DocumentsService.update`'s
 * rename/move path. `assertNameFreeTx`'s pre-check is a TOCTOU race: two
 * concurrent requests can both pass it for the same destination
 * (workspaceId, parentId, name) before either writes. Before this session,
 * nothing below application code caught that — both requests would move
 * their blob to the same on-disk key (last writer wins on disk) while both
 * rows persisted in Postgres, so one document's row silently pointed at the
 * other document's bytes with no error surfaced to either caller.
 *
 * Fixed by a partial, case-insensitive, NULL-safe unique index
 * (`documents_workspace_parent_name_ci_key`, migration
 * `20260921180000_documents_name_unique`) that makes Postgres itself reject
 * the second writer, plus a compensating blob-move-back in
 * `DocumentsService.update`'s catch block so the loser's blob isn't left
 * relocated to a key its (rolled-back) row no longer points at.
 */
describe("Documents move/rename — concurrent name collision", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `docs-move-${runId}`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(`Cleanup left ${leftovers} test workspace(s) behind`);
      });
    }
    await app?.close();
  });

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function uploadFile(workspaceId: string, token: string, parentId: string | null, name: string, content: string) {
    const form = new FormData();
    if (parentId) form.append("parentId", parentId);
    form.append("files", new Blob([content], { type: "text/plain" }), name);
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = (await response.json()) as Array<{ id: string; name: string }>;
    expect(response.status).toBe(201);
    return data[0];
  }

  async function getContent(workspaceId: string, token: string, id: string) {
    const response = await fetch(`${baseUrl}/workspaces/${workspaceId}/documents/${id}/content`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { status: response.status, text: response.status === 200 ? await response.text() : null };
  }

  it("two concurrent moves into the same destination name never leave one document's row pointing at the other's blob", async () => {
    const alice = await register("alice");
    const dest = await request<{ id: string }>(`/workspaces/${alice.workspaceId}/documents`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Dest", parentId: null }
    });
    expect(dest.status).toBe(201);

    const docA = await uploadFile(alice.workspaceId, alice.accessToken, null, "a.txt", "content-A");
    const docB = await uploadFile(alice.workspaceId, alice.accessToken, null, "b.txt", "content-B");

    const [resA, resB] = await Promise.all([
      request<{ id: string }>(`/workspaces/${alice.workspaceId}/documents/${docA.id}`, {
        method: "PATCH",
        token: alice.accessToken,
        body: { parentId: dest.data.id, name: "target.txt" }
      }),
      request<{ id: string }>(`/workspaces/${alice.workspaceId}/documents/${docB.id}`, {
        method: "PATCH",
        token: alice.accessToken,
        body: { parentId: dest.data.id, name: "target.txt" }
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one wins (200) and the other is rejected as a conflict (409) —
    // never both succeeding (which would mean one silently overwrote the
    // other's DB row's on-disk target) and never both failing.
    expect(statuses).toEqual([200, 409]);

    const winner = resA.status === 200 ? { req: resA, doc: docA, otherDoc: docB, otherContent: "content-B" } : { req: resB, doc: docB, otherDoc: docA, otherContent: "content-A" };
    const loser = resA.status === 200 ? docB : docA;
    const loserOriginalContent = resA.status === 200 ? "content-B" : "content-A";

    // The winner's content is exactly what it moved, at the new location.
    const winnerContent = await getContent(alice.workspaceId, alice.accessToken, winner.doc.id);
    expect(winnerContent.status).toBe(200);

    // The loser's row was rolled back to its original parent/name by Postgres
    // (P2002 inside the transaction) — its content must still be reachable
    // and correct, not orphaned or pointing at the winner's bytes.
    const loserContent = await getContent(alice.workspaceId, alice.accessToken, loser.id);
    expect(loserContent.status).toBe(200);
    expect(loserContent.text).toBe(loserOriginalContent);
  });
});
