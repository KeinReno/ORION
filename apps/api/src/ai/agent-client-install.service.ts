import fs from "node:fs";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { createAgentTokenInputSchema, type AgentInstallClient, type InstallAgentClientInput, type InstalledAgentClient } from "@orion/shared-types";
import { CLIENT_RESTART_HINT, clientConfigPath, mergeClientConfig, writeClientConfig, type McpServerEntry } from "./agent-client-install";
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
 * into the program's config on this computer. The secret goes straight into that file and is never returned.
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
    const entryWith = (secret: string): McpServerEntry => ({
      command: info.command as string,
      args: info.args,
      env: { ORION_AGENT_TOKEN: secret, ORION_API_URL: info.apiUrl as string }
    });
    // Check the file BEFORE issuing a token: a config we cannot parse is not overwritten.
    try {
      mergeClientConfig(input.client, existing, entryWith("check"));
    } catch {
      throw new BadRequestException(`Файл настроек ${configPath} повреждён или в неожиданном формате — ORION не стал его менять. Подключите программу вручную.`);
    }

    const label = INSTALL_CLIENT_LABEL[input.client];
    const previous = (await this.tokens.list(userId, workspaceId)).filter(
      (token) => token.name === label && token.revokedAt === null && (token.expiresAt === null || Date.parse(token.expiresAt) > Date.now())
    );
    const created = await this.tokens.create(userId, workspaceId, createAgentTokenInputSchema.parse({ name: label, scopes: input.scopes, modulePermissions: input.modulePermissions ?? [], expiresInDays: 90 }));

    let backupPath: string | null;
    try {
      backupPath = writeClientConfig(configPath, mergeClientConfig(input.client, existing, entryWith(created.secret)));
    } catch (error) {
      await this.tokens.revoke(userId, workspaceId, created.id).catch(() => undefined);
      this.logger.warn(`Не удалось записать ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw new BadRequestException(`Не удалось записать ${configPath} — подключите программу вручную`);
    }

    // The config now holds the new token: the program's earlier tokens here are dead weight — revoke them.
    let revokedPrevious = 0;
    for (const token of previous) {
      try {
        await this.tokens.revoke(userId, workspaceId, token.id);
        revokedPrevious += 1;
      } catch {
        /* a token that cannot be revoked now stays listed; the user can revoke it by hand */
      }
    }
    return { client: input.client, tokenName: label, configPath, backupPath, revokedPrevious, restartHint: CLIENT_RESTART_HINT[input.client] };
  }
}
