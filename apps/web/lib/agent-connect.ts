import type { AgentConnectionInfo } from "@orion/shared-types";

export const AGENT_CLIENTS = ["claude-desktop", "claude-code", "cursor", "codex", "other"] as const;
export type AgentClient = (typeof AGENT_CLIENTS)[number];

export const AGENT_CLIENT_LABEL: Record<AgentClient, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  other: "Другой клиент"
};

export interface ConnectSnippet {
  /** Where the person pastes it, in words. */
  where: string;
  language: "json" | "toml" | "shell";
  text: string;
}

const FALLBACK_API = "http://127.0.0.1:4000";

function quoteArg(value: string): string {
  return /^[\w./:\\@%+=-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * The paste-ready configuration for each client, built from the REAL command of this install (`info`) and the
 * freshly issued secret. Pure: no I/O, so it is unit-tested. Returns `null` when this ORION has no MCP adapter to
 * launch (a server install, or a broken package) — the wizard then shows the REST contract instead.
 */
export function buildConnectSnippet(client: AgentClient, info: AgentConnectionInfo, secret: string): ConnectSnippet | null {
  const apiUrl = info.apiUrl ?? FALLBACK_API;
  if (client === "other") {
    return {
      where: "Любой клиент: переменные окружения и запрос к REST-контракту (руководство — GET /ai/v1/manual).",
      language: "shell",
      text: [
        `ORION_API_URL=${apiUrl}`,
        `ORION_AGENT_TOKEN=${secret}`,
        "",
        ...(info.command ? [`# MCP (stdio): ${[info.command, ...info.args].map(quoteArg).join(" ")}`, ""] : []),
        `curl -H "Authorization: Bearer ${secret}" ${apiUrl}/ai/v1/context`
      ].join("\n")
    };
  }
  if (!info.command) return null;
  const env = { ORION_AGENT_TOKEN: secret, ORION_API_URL: apiUrl };
  if (client === "claude-code") {
    return {
      where: "Выполните в терминале (область — только этот пользователь).",
      language: "shell",
      text: `claude mcp add orion --scope user -e ORION_AGENT_TOKEN=${secret} -e ORION_API_URL=${apiUrl} -- ${[info.command, ...info.args].map(quoteArg).join(" ")}`
    };
  }
  if (client === "codex") {
    return {
      where: "Добавьте в ~/.codex/config.toml (на Windows — %USERPROFILE%\\.codex\\config.toml).",
      language: "toml",
      text: [
        "[mcp_servers.orion]",
        `command = ${JSON.stringify(info.command)}`,
        `args = ${JSON.stringify(info.args)}`,
        `env = { ORION_AGENT_TOKEN = ${JSON.stringify(secret)}, ORION_API_URL = ${JSON.stringify(apiUrl)} }`
      ].join("\n")
    };
  }
  const where =
    client === "cursor"
      ? "Добавьте в ~/.cursor/mcp.json (или .cursor/mcp.json проекта), затем перезапустите Cursor."
      : "Добавьте в claude_desktop_config.json (Claude Desktop → Настройки → Разработчик → Изменить конфигурацию), затем перезапустите Claude.";
  return { where, language: "json", text: JSON.stringify({ mcpServers: { orion: { command: info.command, args: info.args, env } } }, null, 2) };
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
}

/** «Проверить подключение»: the same call the agent will make first, with the token that was just issued. */
export async function checkAgentConnection(apiUrl: string, secret: string, fetchImpl: typeof fetch = fetch): Promise<ConnectionCheck> {
  try {
    const response = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/ai/v1/me`, { headers: { Authorization: `Bearer ${secret}` } });
    if (response.status === 401) return { ok: false, message: "Токен не принят (401): скопируйте его заново или выпустите новый." };
    if (!response.ok) return { ok: false, message: `ORION ответил ${response.status}.` };
    const me = (await response.json()) as { tokenName: string; scopes: string[] };
    return { ok: true, message: `Работает: токен «${me.tokenName}», разрешений: ${me.scopes.length}.` };
  } catch {
    return { ok: false, message: `Нет связи с ${apiUrl}. Запущен ли ORION?` };
  }
}
