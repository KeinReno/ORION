import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Shared by the e2e specs: fresh accounts through the API and a signed-in browser page. */

export interface Account {
  accessToken: string;
  refreshToken: string;
  workspaceId: string;
}

export function apiUrl(): string {
  return `http://localhost:${process.env.E2E_API_PORT ?? 4000}`;
}

export async function register(request: APIRequestContext, label: string): Promise<Account> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`${apiUrl()}/auth/register`, {
    data: { name: `E2E ${label}`, email: `e2e-${label}-${stamp}@example.test`, password: "e2e-Strong-Password-42" }
  });
  expect(response.status(), await response.text()).toBe(201);
  const auth = (await response.json()) as { accessToken: string; refreshToken: string };
  const spaces = await request.get(`${apiUrl()}/workspaces/me`, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
  expect(spaces.ok()).toBe(true);
  const list = (await spaces.json()) as { id: string }[];
  expect(list.length).toBeGreaterThan(0);
  return { accessToken: auth.accessToken, refreshToken: auth.refreshToken, workspaceId: list[0].id };
}

export async function disableAllPlugins(request: APIRequestContext, account: Account): Promise<void> {
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const states = (await (await request.get(`${apiUrl()}/workspaces/${account.workspaceId}/plugins`, { headers })).json()) as {
    id: string;
    enabled: boolean;
  }[];
  for (const plugin of states.filter((state) => state.enabled)) {
    const response = await request.patch(`${apiUrl()}/workspaces/${account.workspaceId}/plugins/${plugin.id}`, {
      headers,
      data: { enabled: false }
    });
    expect(response.ok(), `disable ${plugin.id}: ${await response.text()}`).toBe(true);
  }
}

export async function signIn(page: Page, account: Account): Promise<void> {
  await page.addInitScript((tokens) => {
    window.localStorage.setItem("orion.auth.accessToken", tokens.accessToken);
    window.localStorage.setItem("orion.auth.refreshToken", tokens.refreshToken);
  }, account);
}

