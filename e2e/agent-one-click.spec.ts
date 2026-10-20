import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { apiUrl, register, signIn } from "./support";

/**
 * «Подключить в один клик»: the API runs with ORION_AGENT_CLIENT_HOME=tmp/e2e-agent-home (a scratch profile), so the
 * button writes Claude Desktop's config there — never into the real one of the machine running the tests.
 */
const scratch = process.env.ORION_E2E_AGENT_HOME;
const home = path.resolve(scratch ?? "tmp/e2e-agent-home");
const config = path.join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");

test("one click writes ORION into Claude Desktop's config, keeps the rest, and shows when the program connects", async ({ page, request }) => {
  test.skip(process.platform !== "win32", "the scratch profile mirrors the Windows layout");
  // Without the confirmation the API may be using the REAL profile of this machine — never write there from a test.
  test.skip(!scratch, "the API was not started with ORION_AGENT_CLIENT_HOME (see playwright.config.ts)");
  test.setTimeout(90_000);
  fs.mkdirSync(path.dirname(config), { recursive: true });
  fs.writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: "gh" } } }));

  const account = await register(request, "agent-one-click");
  await signIn(page, account);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  await page.getByRole("button", { name: "ИИ и агенты", exact: true }).click();

  await page.getByRole("button", { name: "Подключить Claude Desktop автоматически", exact: true }).click();
  const status = page.getByRole("status").filter({ hasText: "ORION добавлен в настройки Claude Desktop" });
  await expect(status).toBeVisible();
  await expect(status).toContainText("Перезапустите Claude Desktop");
  await expect(status).toContainText("Жду первого обращения");

  const written = JSON.parse(fs.readFileSync(config, "utf8")) as { mcpServers: Record<string, { env?: Record<string, string>; command: string }> };
  expect(written.mcpServers.github).toEqual({ command: "gh" });
  const secret = written.mcpServers.orion!.env!.ORION_AGENT_TOKEN!;
  // What Claude Desktop would do first, through the MCP adapter: one call with the token from its config.
  expect((await request.get(`${apiUrl()}/ai/v1/tasks`, { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(200);
  await expect(status).toContainText("Подключено", { timeout: 10_000 });
});
