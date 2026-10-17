import { z } from "zod";

/**
 * ТЗ-05 §5.5 — перенос пространства между узлами. Экспорт даёт файл `.orion`
 * (снапшот + байты файлов, опционально под паролем); импорт на другом узле
 * создаёт НОВОЕ пространство с новыми id и не трогает существующие данные.
 */
export const workspaceTransferPreviewSchema = z.object({
  sourceName: z.string(),
  exportedAt: z.string(),
  /** Имя, под которым появится новое пространство. */
  targetName: z.string(),
  /** Строк по модулям, которые будут созданы. */
  incoming: z.record(z.string(), z.number().int()),
  files: z.number().int(),
  /** Сколько id из файла уже занято на этом узле — все получат новые id, чужое не затрагивается. */
  idCollisions: z.number().int(),
  /** Ссылки на людей, переписанные на вас (авторы, исполнители, владельцы личных счетов). */
  reassignedToImporter: z.number().int(),
  /** Необязательные ссылки на то, чего нет в файле, — обнулены. */
  clearedReferences: z.number().int(),
  /** Связи, у которых вторая сторона не попала в файл. */
  droppedRows: z.number().int(),
  /** Что в файле есть, но сознательно не переносится (например, выданные доступы). */
  skippedModels: z.array(z.string()),
  /** Причины, по которым перенос невозможен (пусто — можно применять). */
  problems: z.array(z.string()),
  /** sha256 файла; при применении клиент возвращает его как `expectedHash`. */
  fileHash: z.string(),
  applied: z.boolean(),
  /** Id созданного пространства (только после применения). */
  workspaceId: z.string().nullable()
});
export type WorkspaceTransferPreview = z.infer<typeof workspaceTransferPreviewSchema>;

export const exportWorkspaceInputSchema = z.object({
  /** Пароль к файлу. Пусто — файл без шифрования (его всё равно нельзя прочитать без доступа к самому файлу). */
  passphrase: z.string().max(200).optional()
});
export type ExportWorkspaceInput = z.infer<typeof exportWorkspaceInputSchema>;
