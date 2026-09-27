import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/**
 * S16 «Inventory concurrency/append-only». `InventoryItem.balance` is never
 * a stored column — `InventoryService` sums `InventoryMovement` rows on the
 * fly (see the file comment in `inventory.service.ts` / `shared-types/inventory.ts`).
 * That design only avoids the classic read-then-write race if concurrent
 * writers are also serialised against each other, which `recordMovement`
 * does via `SELECT ... FOR UPDATE` on the item row before checking the
 * balance and inserting the movement, all inside one `withUser` transaction.
 *
 * This test proves the invariant with real concurrency (`Promise.all`, not
 * two sequential `await`s — a sequential test cannot expose a race the row
 * lock is supposed to catch or fail to catch): two simultaneous "issue 5"
 * requests against a balance of 8 must never both succeed (that would leave
 * balance = -2, negative stock with no business decision behind it). Exactly
 * one must be accepted and the other rejected 400, and the final balance
 * (recomputed independently from the ledger) must match the ledger sum,
 * never go negative, and never be a value neither request implies. It also
 * checks append-only: there is no endpoint to edit or delete a movement, so
 * the balance can never diverge from the ledger by mutation after the fact.
 */
describe("inventory — concurrent movements never overdraw the ledger (S16)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `inv-s16-${runId}`;

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
        const users = await tx.user.findMany({
          where: { email: { startsWith: emailPrefix } },
          select: { id: true }
        });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({
          where: { userId: { in: userIds } },
          select: { workspaceId: true }
        });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      });
    }
    await app?.close();
  });

  it("two concurrent issues that would overdraw the balance: exactly one succeeds, none goes negative", async () => {
    const alice = await register("race-issue");
    const ws = alice.workspaceId;

    const item = await request<{ id: string }>(`/workspaces/${ws}/inventory/items`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Гайки М6", unit: "шт" }
    });
    expect(item.status).toBe(201);
    const itemId = item.data.id;

    const receipt = await request(`/workspaces/${ws}/inventory/items/${itemId}/movements`, {
      method: "POST",
      token: alice.accessToken,
      body: { type: "receipt", quantity: 8 }
    });
    expect(receipt.status).toBe(201);

    // Real concurrency: both "issue 5" requests fired together against a
    // balance of 8. Naive read-then-write would let both pass (8 - 5 - 5 = -2).
    const [resA, resB] = await Promise.all([
      request(`/workspaces/${ws}/inventory/items/${itemId}/movements`, {
        method: "POST",
        token: alice.accessToken,
        body: { type: "issue", quantity: 5 }
      }),
      request(`/workspaces/${ws}/inventory/items/${itemId}/movements`, {
        method: "POST",
        token: alice.accessToken,
        body: { type: "issue", quantity: 5 }
      })
    ]);

    const statuses = [resA.status, resB.status].sort();
    // Exactly one issue succeeds (201), the other is rejected as insufficient stock (400).
    expect(statuses).toEqual([201, 400]);

    const listed = await request<Array<{ id: string; balance: number }>>(`/workspaces/${ws}/inventory/items?includeArchived=true`, {
      method: "GET",
      token: alice.accessToken
    });
    const dto = listed.data.find((i) => i.id === itemId);
    expect(dto).toBeDefined();
    // 8 receipt - 5 (exactly one issue) = 3. Never negative, never -2, never 8 (both rejected) or -7 (both applied).
    expect(dto?.balance).toBe(3);
    expect(dto!.balance).toBeGreaterThanOrEqual(0);

    // Balance is derived, not stored — cross-check it against a fresh sum
    // over the ledger directly, bypassing the service entirely.
    const ledgerSum = await prisma.asSystem(async (tx) => {
      const rows = await tx.inventoryMovement.findMany({ where: { itemId }, select: { quantity: true } });
      return rows.reduce((sum, r) => sum + r.quantity, 0);
    });
    expect(ledgerSum).toBe(dto?.balance);

    // Exactly one movement row for the two racing issues (the rejected one
    // never got as far as `inventoryMovement.create`), plus the receipt.
    const movements = await request<Array<{ type: string; quantity: number }>>(
      `/workspaces/${ws}/inventory/items/${itemId}/movements`,
      { method: "GET", token: alice.accessToken }
    );
    const issues = movements.data.filter((m) => m.type === "issue");
    expect(issues.length).toBe(1);
  });

  it("append-only: there is no route to edit or delete a movement, so the ledger can't drift from the balance after the fact", async () => {
    const alice = await register("append-only");
    const ws = alice.workspaceId;

    const item = await request<{ id: string }>(`/workspaces/${ws}/inventory/items`, {
      method: "POST",
      token: alice.accessToken,
      body: { name: "Болты М8", unit: "шт" }
    });
    const itemId = item.data.id;
    const movement = await request<{ id: string }>(`/workspaces/${ws}/inventory/items/${itemId}/movements`, {
      method: "POST",
      token: alice.accessToken,
      body: { type: "receipt", quantity: 10 }
    });
    const movementId = movement.data.id;

    // No PATCH/PUT/DELETE route exists for a single movement — confirm the
    // server actually has none of them wired (405/404), not just that the
    // client happens not to call one.
    const patchAttempt = await request(`/workspaces/${ws}/inventory/movements/${movementId}`, {
      method: "PATCH",
      token: alice.accessToken,
      body: { quantity: 999 }
    });
    expect([404, 405]).toContain(patchAttempt.status);

    const deleteAttempt = await request(`/workspaces/${ws}/inventory/movements/${movementId}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect([404, 405]).toContain(deleteAttempt.status);

    const deleteViaItemsPath = await request(`/workspaces/${ws}/inventory/items/${itemId}/movements/${movementId}`, {
      method: "DELETE",
      token: alice.accessToken
    });
    expect([404, 405]).toContain(deleteViaItemsPath.status);

    // The row is untouched — quantity still matches what was created, no
    // direct mutation path exists in the Prisma layer either (service has
    // no updateMovement/deleteMovement method — verified by reading
    // inventory.service.ts, which exposes only create/list for movements).
    const row = await prisma.asSystem((tx) => tx.inventoryMovement.findUnique({ where: { id: movementId } }));
    expect(row?.quantity).toBe(10);
  });

  async function register(name: string): Promise<{ accessToken: string; user: { id: string }; workspaceId: string }> {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", {
      method: "GET",
      token: response.data.accessToken
    });
    expect(workspaces.status).toBe(200);
    return { ...response.data, workspaceId: workspaces.data[0].id };
  }

  async function request<T = unknown>(
    path: string,
    options: { method: string; token?: string; body?: unknown }
  ): Promise<{ status: number; data: T }> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: {
        "Content-Type": "application/json",
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: response.status, data };
  }
});
