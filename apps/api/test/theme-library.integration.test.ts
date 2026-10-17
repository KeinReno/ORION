import { themeDocumentSchema, type ThemeDocument, type UserPreference, type Workspace } from "@orion/shared-types";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/common/prisma.service";
import { configureApp } from "../src/configure-app";

/** Theme library (several own themes, conflicts, deletion of the active one) and the owner-set workspace palette. */
describe("Theme library and workspace theme", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const emailPrefix = `theme-library-${runId}`;

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

  async function request<T = unknown>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  async function register(name: string) {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: `${emailPrefix}-${name}@example.test`, password: "integration-password-123", name }
    });
    expect(response.status).toBe(201);
    const workspaces = await request<Workspace[]>("/workspaces/me", { method: "GET", token: response.data.accessToken });
    return { token: response.data.accessToken, userId: response.data.user.id, workspaceId: workspaces.data[0].id };
  }

  const theme = (id: string, accent = "#336699"): ThemeDocument => themeDocumentSchema.parse({
    schemaVersion: 1, id, name: `Тема ${id}`, baseMode: "dark",
    colors: { ...Object.fromEntries(themeDocumentSchema.shape.colors.keyof().options.map(key => [key, "#202020"])), textPrimary: "#f0f0f0", accent }
  });
  const save = (token: string, doc: ThemeDocument, expectedUpdatedAt?: string | null) =>
    request<UserPreference>(`/settings/themes/${doc.id}`, { method: "PUT", token, body: { document: doc, ...(expectedUpdatedAt !== undefined ? { expectedUpdatedAt } : {}) } });

  it("keeps several own themes, rejects stale edits and survives a fresh read", async () => {
    const user = await register("crud");
    const fresh = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.token });
    expect(fresh.data).toMatchObject({ themeLibrary: [], activeThemeId: null, workspaceThemeMode: "follow" });

    const first = await save(user.token, theme("my-one"), null);
    expect(first.status).toBe(200);
    expect((await save(user.token, theme("my-two"), null)).status).toBe(200);
    const created = first.data.themeLibrary[0].updatedAt;

    // A second "create" of the same id is a conflict, not a silent overwrite.
    expect((await save(user.token, theme("my-one", "#aa0000"), null)).status).toBe(409);
    const edited = await save(user.token, { ...theme("my-one", "#118844"), name: "Переименована" }, created);
    expect(edited.status).toBe(200);
    const stale = await save(user.token, theme("my-one", "#990000"), created);
    expect(stale.status).toBe(409);
    expect(stale.data).toMatchObject({ code: "theme_revision_conflict", current: { document: { name: "Переименована" } } });
    // "Save mine over it" — no expected revision — wins deliberately.
    expect((await save(user.token, theme("my-one", "#990000"))).status).toBe(200);

    const read = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.token });
    expect(read.data.themeLibrary.map(e => e.document.id)).toEqual(["my-one", "my-two"]);
    expect(read.data.themeLibrary[0].document.colors.accent).toBe("#990000");

    expect((await save(user.token, theme("arctic"), null)).status).toBe(400);
    expect((await request(`/settings/themes/other-id`, { method: "PUT", token: user.token, body: { document: theme("my-one") } })).status).toBe(400);
    expect((await request(`/settings/themes/my-one`, { method: "PUT", token: user.token, body: { document: { ...theme("my-one"), colors: { accent: "url(x)" } } } })).status).toBe(400);
  });

  it("lands concurrent saves of different themes from two devices", async () => {
    const user = await register("concurrent");
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => save(user.token, theme(`device-${i}`), null)));
    expect(results.every(r => r.status === 200)).toBe(true);
    const read = await request<UserPreference>("/settings/preferences", { method: "GET", token: user.token });
    expect(read.data.themeLibrary.map(e => e.document.id).sort()).toEqual(["device-0", "device-1", "device-2", "device-3", "device-4", "device-5"]);
  });

  it("activates only existing themes and falls back to the default when the active one is deleted", async () => {
    const user = await register("active");
    const patch = (body: unknown) => request<UserPreference>("/settings/preferences", { method: "PATCH", token: user.token, body });
    expect((await patch({ theme: "kaiden-precision", activeThemeId: "missing-theme" })).status).toBe(400);
    expect((await patch({ theme: "kaiden-precision", activeThemeId: "arctic" })).data).toMatchObject({ activeThemeId: "arctic" });
    await save(user.token, theme("mine"), null);
    expect((await patch({ activeThemeId: "mine" })).data).toMatchObject({ activeThemeId: "mine", theme: "kaiden-precision" });
    const deleted = await request<UserPreference>("/settings/themes/mine", { method: "DELETE", token: user.token });
    expect(deleted.status).toBe(200);
    expect(deleted.data).toMatchObject({ activeThemeId: null, themeLibrary: [] });
    expect((await request("/settings/themes/mine", { method: "DELETE", token: user.token })).status).toBe(404);
    expect((await patch({ workspaceThemeMode: "personal" })).data).toMatchObject({ workspaceThemeMode: "personal" });
    expect((await patch({ workspaceThemeMode: "everyone" })).status).toBe(400);
    // The library is never written through the general PATCH: the field is ignored there.
    await save(user.token, theme("keep"), null);
    expect((await patch({ themeLibrary: [] })).data.themeLibrary.map(e => e.document.id)).toEqual(["keep"]);
  });

  it("mirrors writes of an older client (single legacy slot) into the library", async () => {
    const user = await register("legacy");
    const patch = (body: unknown) => request<UserPreference>("/settings/preferences", { method: "PATCH", token: user.token, body });
    const enabled = await patch({ theme: "kaiden-precision", customTheme: theme("old-client"), customThemeEnabled: true });
    expect(enabled.data).toMatchObject({ activeThemeId: "old-client", themeLibrary: [{ document: { id: "old-client" } }] });
    // A preset id from an imported legacy file gets its own id, as in the migration.
    const arctic = await patch({ customTheme: theme("arctic"), customThemeEnabled: true });
    expect(arctic.data.activeThemeId).toBe("custom-arctic");
    expect(arctic.data.themeLibrary.map(e => e.document.id)).toEqual(["old-client", "custom-arctic"]);
    expect((await patch({ customThemeEnabled: false })).data.activeThemeId).toBeNull();
    await patch({ customThemeEnabled: true });
    const cleared = await patch({ customTheme: null });
    expect(cleared.data).toMatchObject({ activeThemeId: null, customTheme: null });
    // Clearing the slot never deletes the library copy.
    expect(cleared.data.themeLibrary.map(e => e.document.id)).toEqual(["old-client", "custom-arctic"]);
    // A current client's choice is not disturbed by unrelated patches.
    await patch({ activeThemeId: "midnight" });
    expect((await patch({ density: "compact" })).data.activeThemeId).toBe("midnight");
  });

  it("keeps libraries private per account", async () => {
    const alice = await register("alice"); const bob = await register("bob");
    await save(alice.token, theme("alice-only"), null);
    const other = await request<UserPreference>("/settings/preferences", { method: "GET", token: bob.token });
    expect(other.data.themeLibrary).toEqual([]);
    expect((await request("/settings/themes/alice-only", { method: "DELETE", token: bob.token })).status).toBe(404);
    expect((await request("/settings/themes/x", { method: "PUT", body: { document: theme("x") } })).status).toBe(401);
  });

  it("lets only the owner set a workspace theme, shows it to members and keeps other workspaces untouched", async () => {
    const owner = await register("ws-owner");
    const member = await register("ws-member");
    await prisma.asSystem((tx) => tx.workspaceMember.create({ data: { workspaceId: owner.workspaceId, userId: member.userId, role: "member" } }));
    const shared = theme("family-theme", "#c05000");

    const denied = await request(`/workspaces/${owner.workspaceId}/theme`, { method: "PUT", token: member.token, body: { theme: shared } });
    expect(denied.status).toBe(403);
    const outsider = await register("ws-outsider");
    expect((await request(`/workspaces/${owner.workspaceId}/theme`, { method: "PUT", token: outsider.token, body: { theme: shared } })).status).toBe(403);

    const set = await request<Workspace>(`/workspaces/${owner.workspaceId}/theme`, { method: "PUT", token: owner.token, body: { theme: shared } });
    expect(set.status).toBe(200);
    expect(set.data.theme).toEqual(shared);
    const memberView = await request<Workspace[]>("/workspaces/me", { method: "GET", token: member.token });
    expect(memberView.data.find(w => w.id === owner.workspaceId)?.theme).toEqual(shared);
    expect(memberView.data.find(w => w.id === member.workspaceId)?.theme).toBeNull();

    // A member choosing "always mine" changes only their own preference, never the workspace.
    await request("/settings/preferences", { method: "PATCH", token: member.token, body: { workspaceThemeMode: "personal" } });
    const ownerView = await request<Workspace[]>("/workspaces/me", { method: "GET", token: owner.token });
    expect(ownerView.data.find(w => w.id === owner.workspaceId)?.theme).toEqual(shared);

    expect((await request(`/workspaces/${owner.workspaceId}/theme`, { method: "PUT", token: owner.token, body: { theme: { ...shared, colors: { accent: "red" } } } })).status).toBe(400);
    const cleared = await request<Workspace>(`/workspaces/${owner.workspaceId}/theme`, { method: "PUT", token: owner.token, body: { theme: null } });
    expect(cleared.data.theme).toBeNull();
  });
});
