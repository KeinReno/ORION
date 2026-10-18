import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ASSISTANT_DEFAULT_MODEL, type AssistantKeyStatus, type SetAssistantKeyInput, setAssistantKeyInputSchema } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { openSecret, sealSecret, SyncSecretMissingError } from "../sync/sync-crypto";
import { aiBridgeEnabled } from "./agent-tokens.service";

/**
 * Ключ владельца к языковой модели (ADR-0017, вариант C). Хранится зашифрованным (`sealSecret`, ключ узла `SYNC_SECRET`),
 * читается только владельцем строки (RLS по `userId`), наружу не отдаётся: статус говорит лишь «сохранён или нет».
 */
@Injectable()
export class AssistantKeyService {
  constructor(private readonly prisma: PrismaService) {}

  private unavailableReason(): string | null {
    if (!aiBridgeEnabled()) return "Мост для агентов выключен на этом сервере (ORION_AI_BRIDGE=1 включает)";
    if (!process.env.SYNC_SECRET?.trim()) return "На этом узле не задан SYNC_SECRET — ключ нельзя хранить зашифрованным";
    return null;
  }

  async status(userId: string): Promise<AssistantKeyStatus> {
    const row = await this.prisma.withUser(userId, (tx) => tx.assistantKey.findUnique({ where: { userId }, select: { provider: true, model: true } }));
    const reason = this.unavailableReason();
    return { configured: row !== null, provider: row?.provider ?? null, model: row?.model ?? null, available: reason === null, reason };
  }

  async save(userId: string, input: SetAssistantKeyInput): Promise<AssistantKeyStatus> {
    const parsed = setAssistantKeyInputSchema.parse(input);
    const reason = this.unavailableReason();
    if (reason) throw new ServiceUnavailableException(reason);
    let keyEnc: string;
    try {
      keyEnc = sealSecret(parsed.apiKey);
    } catch (error) {
      if (error instanceof SyncSecretMissingError) throw new ServiceUnavailableException(error.message);
      throw error;
    }
    await this.prisma.withUser(userId, (tx) =>
      tx.assistantKey.upsert({
        where: { userId },
        create: { userId, provider: "anthropic", model: parsed.model || ASSISTANT_DEFAULT_MODEL, keyEnc },
        update: { model: parsed.model || ASSISTANT_DEFAULT_MODEL, keyEnc }
      })
    );
    return this.status(userId);
  }

  async clear(userId: string): Promise<void> {
    await this.prisma.withUser(userId, (tx) => tx.assistantKey.deleteMany({ where: { userId } }));
  }

  /** Расшифрованный ключ и модель — только для вызова провайдера внутри процесса. `null`, если ключ не сохранён. */
  async reveal(userId: string): Promise<{ apiKey: string; model: string } | null> {
    const row = await this.prisma.withUser(userId, (tx) => tx.assistantKey.findUnique({ where: { userId } }));
    if (!row) return null;
    return { apiKey: openSecret(row.keyEnc), model: row.model };
  }
}
