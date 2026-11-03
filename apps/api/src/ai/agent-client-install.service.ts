import fs from "node:fs";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createAgentTokenInputSchema, type AgentInstallClient, type InstallAgentClientInput, type InstalledAgentClient } from "@orion/shared-types";
import { CLIENT_RESTART_HINT, agentTokenFilePath, clientConfigPath, mergeClientConfig, writeClientConfig, writePrivateAgentToken, type McpServerEntry } from "./agent-client-install";
import { resolveAgentConnection } from "./agent-connection";
import { AgentTokensService } from "./agent-tokens.service";

export const INSTALL_CLIENT_LABEL: Record<AgentInstallClient, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex"
};

/**
 * «Подключить в один клик» (see `agent-client-install.ts`): issues a token for the program and writes ORION's MCP entry
 * into the program's config on this computer. The secret lives in a private file, not in config.toml or JSON.
 */
@Injectable()
export class AgentClientInstallService {
  private readonly logger = new Logger(AgentClientInstallService.name);

  constructor(private readonly tokens: AgentTokensService) {}

  async install(userId: string, workspaceId: string, input: InstallAgentClientInput, configPath = clientConfigPath(input.client)): Promise<InstalledAgentClient> {
    const info = resolveAgentConnection();
    if (info.mode === "server") throw new ForbiddenException("Подключение в один клик работает только в локальной установке ORION");
    if (!info.command || !info.apiUrl) {
      throw new ConflictException({ code: "agent_adapter_missing", message: "Не найден MCP-адаптер ORION — подключите программу вручную по инструкции" });
    }

    let existing: string | null = null;
    try {
      existing = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : null;
    } catch {
      throw new BadRequestException(`Не удалось прочитать ${configPath} — подключите программу вручную`);
    }
    const tokenFile = agentTokenFilePath(input.client, configPath);
    const entry: McpServerEntry = {
      command: info.command,
      args: info.args,
      env: { ORION_AGENT_TOKEN_FILE: tokenFile, ORION_API_URL: info.apiUrl }
    };
    // A damaged config must not be overwritten. Refuse symlinks for the token file.
    let merged: string;
    let previousToken: string | null;
    try {
      merged = mergeClientConfig(input.client, existing, entry);
      previousToken = fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8") : null;
      if (previousToken !== null && !/^orion_agt_[A-Za-z0-9_-]{32}\s*$/.test(previousToken)) {
        throw new Error("Unrecognized existing token file");
      }
      if (fs.existsSync(tokenFile) && !fs.lstatSync(tokenFile).isFile()) throw new Error("Unsafe token path");
    } catch {
      throw new BadRequestException("Файл конфигурации или хранилище токена повреждены — ORION не стал их менять");
    }

    const label = INSTALL_CLIENT_LABEL[input.client];
    const previous = (await this.tokens.list(userId, workspaceId)).filter(
      (token) => token.name === label && token.revokedAt === null &&
        (token.expiresAt === null || Date.parse(token.expiresAt) > Date.now())
    );
    const created = await this.tokens.create(userId, workspaceId,
      createAgentTokenInputSchema.parse({
        name: label, mode: input.mode, scopes: input.scopes,
        modulePermissions: input.modulePermissions ?? [], expiresInDays: input.expiresInDays
      })
    );

    let backupPath: string | null;
    try {
      // Check that the running ORION API accepts exactly the new token before changing
      // any client configuration or revoking a previously working credential.
      await verifyLocalAgentBridge(info.apiUrl, created.secret, workspaceId, created.mode);
      writePrivateAgentToken(tokenFile, created.secret);
      backupPath = writeClientConfig(configPath, merged);
    } catch (error) {
      try {
        if (previousToken !== null) {
          const oldSecret = previousToken.trim();
          if (oldSecret.startsWith("orion_agt_")) writePrivateAgentToken(tokenFile, oldSecret);
        } else if (fs.existsSync(tokenFile)) {
          fs.unlinkSync(tokenFile);
        }
      } catch {
        this.logger.error("Не удалось восстановить прежний файл токена — требуется переподключение");
      }
      await this.tokens.revoke(userId, workspaceId, created.id).catch(() => undefined);
      // Never log a raw exception: some HTTP/client errors may contain credentials.
      this.logger.warn("Подключение агента не удалось; новый токен отозван");
      throw new ConflictException("Не удалось проверить или записать подключение. Предыдущий токен не отозван.");
    }

    let revokedPrevious = 0;
    for (const token of previous) {
      try {
        await this.tokens.revoke(userId, workspaceId, token.id);
        revokedPrevious += 1;
      } catch {
        // Unrevoked tokens remain visible to their creator for manual revocation.
      }
    }
    return {
      client: input.client, tokenName: label, configPath, backupPath,
      revokedPrevious, restartHint: CLIENT_RESTART_HINT[input.client], apiVerified: true
    };
  }
}

/**
 * Actual loopback REST handshake, not a fake "client connected" signal. The
 * MCP application still needs to restart and make its own first tool call.
 * Strict loopback validation avoids sending a bearer secret to a remote URL
 * supplied through ORION_PUBLIC_API_URL.
 */
export async function verifyLocalAgentBridge(
  apiUrl: string,
  secret: string,
  workspaceId: string,
  mode: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  let address: URL;
  try {
    address = new URL(apiUrl);
  } catch {
    throw new ConflictException("Некорректный адрес локального API");
  }
  if (address.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
      address.username || address.password || address.pathname !== "/" ||
      address.search || address.hash) {
    throw new ForbiddenException("Автоподключение требует локальный адрес API (loopback)");
  }
  const response = await fetchImpl(new URL("/ai/v1/me", address), {
    headers: { Authorization: `Bearer ${secret}` },
    redirect: "error",
    signal: AbortSignal.timeout(4_000)
  });
  if (!response.ok) throw new ConflictException(`ORION API отклонил новый токен (HTTP ${response.status})`);
  const result = await response.json() as { workspaceId?: string; mode?: string };
  if (result.workspaceId !== workspaceId || result.mode !== mode) {
    throw new ConflictException("Ответ ORION не соответствует выбранному пространству или роли");
  }
}
