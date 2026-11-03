import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createRequire } from "node:module";
interface McpEntry { command: string; args: string[]; env: Record<string, string> }
interface RpcResponse { id: number; error?: unknown; result: { isError?: boolean; [key: string]: unknown } }
const { parse: parseToml } = createRequire(path.resolve("apps/api/package.json"))("smol-toml") as { parse: (value: string) => { mcp_servers: Record<string, McpEntry> } };
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
  await expect(status).toContainText("MCP-клиент нужно перезапустить");

  const written = JSON.parse(fs.readFileSync(config, "utf8")) as { mcpServers: Record<string, { env?: Record<string, string>; command: string }> };
  expect(written.mcpServers.github).toEqual({ command: "gh" });
  expect(written.mcpServers.orion!.env!.ORION_AGENT_TOKEN).toBeUndefined();
  const secret = fs.readFileSync(written.mcpServers.orion!.env!.ORION_AGENT_TOKEN_FILE!, "utf8").trim();
  // What Claude Desktop would do first, through the MCP adapter: one call with the token from its config.
  expect((await request.get(`${apiUrl()}/ai/v1/tasks`, { headers: { Authorization: `Bearer ${secret}` } })).status()).toBe(200);
  await expect(status).toContainText("Последний запрос к API", { timeout: 10_000 });
});


test("Codex admin choice requires consent and token-file launches a real MCP adapter", async ({ page, request }, testInfo) => {
  test.skip(!scratch, "requires an isolated client profile");
  const codexConfig = path.join(home, ".codex", "config.toml");
  fs.mkdirSync(path.dirname(codexConfig), { recursive: true });
  fs.writeFileSync(codexConfig, '[mcp_servers.github]\r\ncommand="gh"\r\n');
  const account = await register(request, "codex-admin");
  await signIn(page, account);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/dashboard?workspaceId=${account.workspaceId}`);
  await page.getByRole("button", { name: "Настройки", exact: true }).first().click();
  await page.getByRole("button", { name: "ИИ и агенты", exact: true }).click();
  await page.getByRole("combobox", { name: "Программа", exact: true }).selectOption("codex");
  await page.getByRole("combobox", { name: "Роль", exact: true }).selectOption("admin");
  const expiry = page.getByRole("combobox", { name: "Срок действия", exact: true });
  await expiry.selectOption("custom");
  const days = page.getByRole("spinbutton", { name: "Дней (1–36500)", exact: true });
  await days.fill("0");
  const install = page.getByRole("button", { name: "Подключить Codex автоматически", exact: true });
  await expect(install).toBeDisabled();
  await days.fill("730"); await expect(install).toBeEnabled();
  await expiry.selectOption("none");
  await page.setViewportSize({ width: 390, height: 844 });
  await install.click();
  const dialog = page.getByRole("dialog", { name: "Выдать права администратора?" });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("admin-consent-390.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  const base = `${apiUrl()}/workspaces/${account.workspaceId}`;
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  expect(await (await request.get(`${base}/agent-tokens`, { headers })).json()).toEqual([]);
  await install.click(); await dialog.getByRole("button", { name: "Выдать доступ", exact: true }).click();
  const status = page.getByRole("status").filter({ hasText: "ORION добавлен в настройки Codex" });
  await expect(status).toBeVisible(); await expect(status).toContainText("MCP-клиент нужно перезапустить");
  const configText = fs.readFileSync(codexConfig, "utf8");
  const config = parseToml(configText);
  expect(config.mcp_servers.github.command).toBe("gh");
  const entry = config.mcp_servers.orion as { command: string; args: string[]; env: Record<string, string> };
  expect(entry.env.ORION_AGENT_TOKEN).toBeUndefined();
  const secret = fs.readFileSync(entry.env.ORION_AGENT_TOKEN_FILE!, "utf8").trim();
  expect(configText).not.toContain(secret);
  const tokens = await (await request.get(`${base}/agent-tokens`, { headers })).json();
  expect(tokens).toHaveLength(1); expect(tokens[0]).toMatchObject({ mode: "admin", expiresAt: null });
  const child = spawn(entry.command, entry.args, { env: { ...process.env, ...entry.env, ORION_AGENT_TOKEN: undefined }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<number, (message: RpcResponse) => void>();
  lines.on("line", line => { const message = JSON.parse(line); responses.get(message.id)?.(message); });
  function rpc(id: number, method: string, params: unknown): Promise<RpcResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MCP adapter response timeout")), 15_000);
      responses.set(id, message => { clearTimeout(timer); responses.delete(id); resolve(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  try {
    const initialized = await rpc(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "isolated-beta37-smoke", version: "1" } });
    expect(initialized.error).toBeUndefined();
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const context = await rpc(2, "tools/call", { name: "orion_get_context", arguments: {} });
    expect(context.error).toBeUndefined(); expect(context.result.isError).not.toBe(true);
    expect(JSON.stringify(context.result)).toContain(account.workspaceId);
  } finally { child.stdin.end(); child.kill(); lines.close(); }
  await page.screenshot({ path: testInfo.outputPath("codex-installed-390.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
