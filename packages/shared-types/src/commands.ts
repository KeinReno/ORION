import { z } from "zod";
import { orionModuleIdSchema } from "./modules";

/**
 * Задание 10.3 — реестр команд и горячие клавиши.
 *
 * Контракт общий с сервером и (в будущем) палитрой команд: команда либо
 * исполняется на сервере (`run.kind = "server"` + `operation`), либо является
 * инструкцией интерфейсу (`run.kind = "ui"` + `route`). Разделение важно:
 * сервер не должен притворяться, что умеет открывать панели, а клиент — что
 * умеет выполнять операции в обход прав.
 */

/** `core` — общие инструменты платформы; остальные — id включённых модулей. */
export const commandModuleSchema = z.union([orionModuleIdSchema, z.literal("core")]);
export type CommandModuleId = z.infer<typeof commandModuleSchema>;

export const commandRunSchema = z
  .object({
    kind: z.enum(["server", "ui"]),
    /** Для серверной команды — id операции, зарегистрированной обработчиком (например `tables.create`). */
    operation: z.string().trim().min(1).max(120).optional(),
    /** Для UI-команды — инструкция маршрута (например `panel:tables`), которую исполняет клиент. */
    route: z.string().trim().min(1).max(300).optional()
  })
  .strict()
  .superRefine((run, ctx) => {
    if (run.kind === "server" && !run.operation) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["operation"], message: "Серверной команде нужна операция" });
    }
    if (run.kind === "ui" && !run.route) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["route"], message: "UI-команде нужен маршрут" });
    }
  });
export type CommandRun = z.infer<typeof commandRunSchema>;

export const commandDefinitionSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9][a-z0-9._-]*$/, "id команды: строчная латиница, цифры, «.», «_», «-»"),
    title: z.string().trim().min(1).max(160),
    module: commandModuleSchema,
    keywords: z.array(z.string().trim().min(1).max(40)).max(20),
    /** Контекст, в котором команда уместна (`task`, `project`, …); `null` — везде. */
    context: z.string().trim().min(1).max(80).nullable(),
    /** Разрешение, которое нужно для исполнения; `null` — только членство в пространстве. */
    permission: z.string().trim().min(1).max(120).nullable(),
    run: commandRunSchema
  })
  .strict();
export type CommandDefinition = z.infer<typeof commandDefinitionSchema>;

export const commandListSchema = z.array(commandDefinitionSchema);
export type CommandList = z.infer<typeof commandListSchema>;

/** Результат исполнения: либо сервер выполнил операцию, либо клиент получил маршрут. */
export const commandExecutionResultSchema = z.union([
  z.object({
    kind: z.literal("executed"),
    commandId: z.string(),
    result: z.unknown()
  }),
  z.object({
    kind: z.literal("instruction"),
    commandId: z.string(),
    route: z.string()
  })
]);
export type CommandExecutionResult = z.infer<typeof commandExecutionResultSchema>;

export const executeCommandInputSchema = z
  .object({
    workspaceId: z.string().min(1),
    args: z.unknown().optional()
  })
  .strict();
export type ExecuteCommandInput = z.infer<typeof executeCommandInputSchema>;

// ---------------------------------------------------------------------------
// Горячие клавиши
// ---------------------------------------------------------------------------

/**
 * Область действия: `global` (везде), `module:<id>` (только в модуле),
 * `context:<id>` (конкретный контекст, например `task`). Строка, а не enum:
 * список модулей расширяется каталогом.
 */
export const keyBindingScopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^(global|module:[a-z0-9-]+|context:[a-z0-9._:-]+)$/, "Область: global, module:<id> или context:<id>");
export type KeyBindingScope = z.infer<typeof keyBindingScopeSchema>;

export const keyBindingKeysSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((keys) => normalizeKeyBinding(keys).length > 0, "Сочетание клавиш пустое");

/**
 * Нормализует сочетание: нижний регистр, без пробелов, модификаторы в одном
 * порядке. Без этого `Ctrl+Shift+K` и `shift+ctrl+k` считались бы разными и
 * конфликт не находился. `cmd`/`command`/`win`/`meta` — один модификатор.
 */
export function normalizeKeyBinding(keys: string): string {
  const aliases: Record<string, string> = { cmd: "meta", command: "meta", win: "meta", super: "meta", control: "ctrl", option: "alt" };
  const order = ["ctrl", "alt", "shift", "meta"];
  const parts = keys
    .split("+")
    .map((part) => part.trim().toLocaleLowerCase("en"))
    .filter(Boolean)
    .map((part) => aliases[part] ?? part);
  if (parts.length === 0) return "";
  const modifiers = parts.filter((part) => order.includes(part)).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const rest = parts.filter((part) => !order.includes(part));
  return [...new Set([...modifiers, ...rest])].join("+");
}

/** Пересекаются ли области: `global` — со всеми, иначе совпадение строки. */
export function keyBindingScopesOverlap(left: string, right: string): boolean {
  return left === "global" || right === "global" || left === right;
}

export interface KeyBindingLike {
  id: string;
  commandId: string;
  keys: string;
  scope: string;
}

export const keyBindingConflictSchema = z.object({
  /** Нормализованное сочетание. */
  keys: z.string(),
  /** Конфликтующие области (может быть несколько, если пересекаются три и более). */
  scopes: z.array(z.string()),
  bindingIds: z.array(z.string()),
  commandIds: z.array(z.string())
});
export type KeyBindingConflict = z.infer<typeof keyBindingConflictSchema>;

/**
 * Конфликты — предупреждение, а не запрет: человек вправе осознанно перекрыть
 * сочетание (например, временно). API возвращает список, чтобы интерфейс мог
 * показать предупреждение и не блокировать сохранение.
 */
export function keyBindingConflicts(bindings: readonly KeyBindingLike[]): KeyBindingConflict[] {
  const byKeys = new Map<string, KeyBindingLike[]>();
  for (const binding of bindings) {
    const keys = normalizeKeyBinding(binding.keys);
    byKeys.set(keys, [...(byKeys.get(keys) ?? []), binding]);
  }
  const conflicts: KeyBindingConflict[] = [];
  for (const [keys, group] of byKeys) {
    if (group.length < 2) continue;
    const ids = new Set<string>();
    const commandIds = new Set<string>();
    const scopes = new Set<string>();
    let overlapping = false;
    for (let left = 0; left < group.length; left += 1) {
      for (let right = left + 1; right < group.length; right += 1) {
        const a = group[left]!;
        const b = group[right]!;
        if (!keyBindingScopesOverlap(a.scope, b.scope)) continue;
        overlapping = true;
        ids.add(a.id);
        ids.add(b.id);
        commandIds.add(a.commandId);
        commandIds.add(b.commandId);
        scopes.add(a.scope);
        scopes.add(b.scope);
      }
    }
    if (overlapping) conflicts.push({ keys, scopes: [...scopes], bindingIds: [...ids], commandIds: [...commandIds] });
  }
  return conflicts;
}

export const keyBindingSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  commandId: z.string(),
  keys: z.string(),
  scope: keyBindingScopeSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});
export type KeyBinding = z.infer<typeof keyBindingSchema>;

export const keyBindingListSchema = z.object({
  bindings: z.array(keyBindingSchema),
  conflicts: z.array(keyBindingConflictSchema)
});
export type KeyBindingList = z.infer<typeof keyBindingListSchema>;

export const createKeyBindingInputSchema = z
  .object({
    commandId: z.string().trim().min(1).max(120),
    keys: keyBindingKeysSchema,
    scope: keyBindingScopeSchema.default("global")
  })
  .strict();
export type CreateKeyBindingInput = z.infer<typeof createKeyBindingInputSchema>;

export const updateKeyBindingInputSchema = z
  .object({
    keys: keyBindingKeysSchema.optional(),
    scope: keyBindingScopeSchema.optional()
  })
  .strict()
  .refine((value) => value.keys !== undefined || value.scope !== undefined, { message: "Нечего менять" });
export type UpdateKeyBindingInput = z.infer<typeof updateKeyBindingInputSchema>;

export const keyBindingWriteResultSchema = z.object({
  binding: keyBindingSchema,
  /** Пересечения с другими сочетаниями этого пользователя — предупреждение, не отказ. */
  conflicts: z.array(keyBindingConflictSchema)
});
export type KeyBindingWriteResult = z.infer<typeof keyBindingWriteResultSchema>;
