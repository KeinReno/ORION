import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes, randomUUID } from "node:crypto";
import type { LinkDevice as LinkDeviceDto, LinkPairing } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { openSecret, sealSecret } from "./sync-crypto";

/**
 * ADR-0020: спаривание Link-устройств и ключи пакетов. `K_ws` создаёт владелец пространства; в БД он лежит
 * завёрнутым `sealSecret` (SYNC_SECRET здесь только оболочка хранения, ключом пакетов не является).
 * Фоновый приём пакетов ходит через `asSystem` (`hostFor`, `keysFor`), остальное — от имени пользователя.
 */
@Injectable()
export class LinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  /** Спаривает устройство вызывающего пользователя. Первый вызов в пространстве создаёт ключ (только владелец). */
  async pair(userId: string, workspaceId: string, name: string): Promise<LinkPairing> {
    // 1) членство и роль — под RLS пользователя; 2) ключ — через asSystem (участник читать link_keys не может);
    // 3) строка устройства — снова под RLS пользователя.
    const role = await this.prisma.withUser(userId, async (tx) => {
      const membership = await this.workspaces.assertMemberRoleTx(tx, userId, workspaceId, ["owner", "member", "lead"]);
      return membership.role;
    });
    const active = await this.prisma.asSystem(async (tx) => {
      const existing = await tx.linkKey.findFirst({
        where: { workspaceId, retiredAt: null },
        orderBy: [{ epoch: "desc" }, { createdAt: "desc" }]
      });
      if (existing) return existing;
      if (role !== "owner") throw new ForbiddenException("Ключ Orion Link в пространстве создаёт его владелец");
      return tx.linkKey.create({
        data: { workspaceId, keyId: randomUUID(), epoch: 1, keyEnc: sealSecret(randomBytes(32).toString("base64")) }
      });
    });
    const device = await this.prisma.withUser(userId, (tx) =>
      tx.linkDevice.create({ data: { workspaceId, userId, name, keyId: active.keyId } })
    );
    return {
      linkDeviceId: device.id,
      workspaceId,
      epoch: active.epoch,
      keyId: active.keyId,
      key: openSecret(active.keyEnc)
    };
  }

  async list(userId: string, workspaceId: string): Promise<LinkDeviceDto[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.linkDevice.findMany({ where: { workspaceId, userId }, orderBy: { createdAt: "asc" } });
      return rows.map(toDeviceDto);
    });
  }

  async revoke(userId: string, workspaceId: string, linkDeviceId: string): Promise<LinkDeviceDto> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const found = await tx.linkDevice.findFirst({ where: { id: linkDeviceId, workspaceId, userId } });
      if (!found) throw new NotFoundException("Устройство Link не найдено");
      const row = found.revokedAt
        ? found
        : await tx.linkDevice.update({ where: { id: found.id }, data: { revokedAt: new Date() } });
      return toDeviceDto(row);
    });
  }

  /**
   * Для приёма пакетов: от чьего имени исполнять запросы Link-устройства. `null` — не спарено, отозвано или
   * пользователь уже не член пространства. Обновляет `lastSeenAt`.
   */
  async userForDevice(workspaceId: string, linkDeviceId: string): Promise<string | null> {
    return this.prisma.asSystem(async (tx) => {
      const device = await tx.linkDevice.findFirst({ where: { id: linkDeviceId, workspaceId, revokedAt: null } });
      if (!device) return null;
      const member = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: device.userId } }
      });
      if (!member) return null;
      await tx.linkDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
      return device.userId;
    });
  }

  /** Ключи для чтения пакетов: активный первым, затем прежние (ротация). */
  async keysFor(workspaceId: string): Promise<{ epoch: number; keys: Array<{ keyId: string; raw: Uint8Array }> } | null> {
    return this.prisma.asSystem(async (tx) => {
      const rows = await tx.linkKey.findMany({
        where: { workspaceId },
        orderBy: [{ retiredAt: { sort: "asc", nulls: "first" } }, { epoch: "desc" }, { createdAt: "desc" }]
      });
      const active = rows.find((r) => !r.retiredAt);
      if (!active) return null;
      return {
        epoch: active.epoch,
        keys: rows.map((r) => ({ keyId: r.keyId, raw: new Uint8Array(Buffer.from(openSecret(r.keyEnc), "base64")) }))
      };
    });
  }
}

function toDeviceDto(row: {
  id: string;
  name: string;
  keyId: string;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
}): LinkDeviceDto {
  return {
    id: row.id,
    name: row.name,
    keyId: row.keyId,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null
  };
}
