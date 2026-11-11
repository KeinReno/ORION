import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  keyBindingConflicts,
  normalizeKeyBinding,
  type CreateKeyBindingInput,
  type KeyBinding,
  type KeyBindingConflict,
  type KeyBindingList,
  type KeyBindingWriteResult,
  type UpdateKeyBindingInput
} from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { CommandRegistry } from "./command.registry";

/**
 * Личные горячие клавиши (задание 10.3): привязка принадлежит участнику
 * (`workspaceId + userId`), поэтому чужие сочетания не видны и не меняются.
 *
 * Конфликт — предупреждение, а не блокировка: `create`/`update` возвращают
 * `conflicts` рядом с сохранённой привязкой, а 409 отдаётся только за повторное
 * сочетание ОДНОЙ команды (уникальный индекс БД).
 */
@Injectable()
export class KeyBindingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly registry: CommandRegistry
  ) {}

  async list(userId: string, workspaceId: string): Promise<KeyBindingList> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.keyBinding.findMany({ where: { workspaceId, userId }, orderBy: [{ updatedAt: "desc" }] });
      return toList(rows);
    });
  }

  async create(userId: string, workspaceId: string, input: CreateKeyBindingInput): Promise<KeyBindingWriteResult> {
    this.assertKnownCommand(input.commandId);
    const keys = normalizeKeyBinding(input.keys);
    if (!keys) throw new BadRequestException("Сочетание клавиш пустое");
    try {
      return await this.prisma.withUser(userId, async (tx) => {
        await this.workspaces.assertMemberTx(tx, userId, workspaceId);
        const row = await tx.keyBinding.create({
          data: { workspaceId, userId, commandId: input.commandId, keys, scope: input.scope }
        });
        const all = await tx.keyBinding.findMany({ where: { workspaceId, userId } });
        return { binding: toDto(row), conflicts: keyBindingConflicts(all) };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("У этой команды уже есть сочетание клавиш — измените существующее");
      }
      throw error;
    }
  }

  async update(
    userId: string,
    workspaceId: string,
    bindingId: string,
    input: UpdateKeyBindingInput
  ): Promise<KeyBindingWriteResult> {
    const keys = input.keys === undefined ? undefined : normalizeKeyBinding(input.keys);
    if (keys === "") throw new BadRequestException("Сочетание клавиш пустое");
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.keyBinding.findFirst({ where: { id: bindingId, workspaceId, userId } });
      if (!existing) throw new NotFoundException("Сочетание клавиш не найдено");
      const row = await tx.keyBinding.update({
        where: { id: existing.id },
        data: { keys, scope: input.scope }
      });
      const all = await tx.keyBinding.findMany({ where: { workspaceId, userId } });
      return { binding: toDto(row), conflicts: keyBindingConflicts(all) };
    });
  }

  async remove(userId: string, workspaceId: string, bindingId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const existing = await tx.keyBinding.findFirst({ where: { id: bindingId, workspaceId, userId } });
      if (!existing) throw new NotFoundException("Сочетание клавиш не найдено");
      await tx.keyBinding.delete({ where: { id: existing.id } });
    });
  }

  /** Привязать сочетание можно к любой зарегистрированной команде, даже у выключенного модуля: включение вернёт её в палитру. */
  private assertKnownCommand(commandId: string): void {
    if (!this.registry.get(commandId)) throw new NotFoundException("Команда не найдена");
  }
}

type KeyBindingRow = {
  id: string;
  workspaceId: string;
  commandId: string;
  keys: string;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
};

function toDto(row: KeyBindingRow): KeyBinding {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    commandId: row.commandId,
    keys: row.keys,
    scope: row.scope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toList(rows: readonly KeyBindingRow[]): KeyBindingList {
  const bindings = rows.map(toDto);
  return { bindings, conflicts: keyBindingConflicts(rows) as KeyBindingConflict[] };
}

/** Экспорт типа конфликта для контроллера (тот же контракт shared-types). */
export type { KeyBindingConflict };
