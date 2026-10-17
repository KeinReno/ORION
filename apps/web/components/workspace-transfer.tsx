"use client";

import { useExportWorkspace, useImportWorkspace } from "@orion/core-react";
import type { WorkspaceTransferPreview } from "@orion/shared-types";
import { Button, Card, Input, useToast } from "@orion/ui";
import { useState } from "react";
import { describeAuthError } from "../lib/error-message";

/**
 * ТЗ-05 §5.5 — перенос пространства между узлами. Экспорт: файл `.orion` (по желанию под паролем).
 * Импорт: предпросмотр → явное подтверждение → НОВОЕ пространство; существующее не затрагивается.
 */
export function ExportWorkspaceCard({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }): React.ReactElement {
  const exporter = useExportWorkspace(workspaceId);
  const { toast } = useToast();
  const [passphrase, setPassphrase] = useState("");

  async function onExport(): Promise<void> {
    try {
      const blob = await exporter.mutateAsync(passphrase || undefined);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${workspaceName.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "workspace"}.orion`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Файл переноса сохранён", description: "Откройте на другом узле: «Пространства» → «Перенести из файла».", tone: "success" });
    } catch (error) {
      toast({ title: "Не удалось выгрузить пространство", description: describeAuthError(error), tone: "danger" });
    }
  }

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">Перенос на другой узел</h3>
      <Card className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Файл содержит всё содержимое пространства «{workspaceName}» вместе с файлами. На другом узле он создаст новое пространство —
          существующие данные там не перезаписываются и не сливаются. Здоровье, токены агентов и выданные доступы не переносятся.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Пароль к файлу (необязательно, но лучше задать)</span>
            <Input type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </label>
          <Button status={exporter.isPending ? "pending" : "idle"} onClick={() => void onExport()}>
            Выгрузить .orion
          </Button>
        </div>
        <p className="text-2xs text-subtle-foreground">Забытый пароль восстановить нельзя.</p>
      </Card>
    </section>
  );
}

export function ImportWorkspaceCard({ onImported }: { onImported: (workspaceId: string) => void }): React.ReactElement {
  const importer = useImportWorkspace();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [name, setName] = useState("");
  const [preview, setPreview] = useState<WorkspaceTransferPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onPreview(): Promise<void> {
    if (!file) return;
    setError(null);
    setPreview(null);
    try {
      setPreview(await importer.mutateAsync({ file, dryRun: true, passphrase: passphrase || undefined, name: name || undefined }));
    } catch (e) {
      setError(describeAuthError(e));
    }
  }

  async function onApply(): Promise<void> {
    if (!file || !preview) return;
    setError(null);
    try {
      const result = await importer.mutateAsync({
        file,
        dryRun: false,
        passphrase: passphrase || undefined,
        name: name || undefined,
        expectedHash: preview.fileHash
      });
      if (result.workspaceId) onImported(result.workspaceId);
    } catch (e) {
      setError(describeAuthError(e));
    }
  }

  const total = preview ? Object.values(preview.incoming).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <Card className="mt-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Перенести из файла .orion</p>
        <p className="text-2xs text-muted-foreground">
          Данные придут как новое пространство, владелец — вы. Ничего из того, что уже есть на этом узле, не изменится.
        </p>
      </div>
      <input
        type="file"
        accept=".orion,application/octet-stream"
        className="text-xs text-muted-foreground"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
          setError(null);
        }}
      />
      <Input type="password" autoComplete="off" placeholder="Пароль к файлу (если задан)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      <Input maxLength={80} placeholder="Название нового пространства (необязательно)" value={name} onChange={(e) => setName(e.target.value)} />
      {error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {preview ? (
        <div className="space-y-1 rounded-lg border border-border bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
          <p className="text-foreground">
            «{preview.sourceName}» → «{preview.targetName}»: {total} записей, файлов: {preview.files}
          </p>
          {preview.idCollisions > 0 ? (
            <p>Идентификаторы {preview.idCollisions} записей уже есть на этом узле — всем будут присвоены новые, существующее не затрагивается.</p>
          ) : null}
          {preview.reassignedToImporter > 0 ? <p>Авторство, исполнители и личные счета ({preview.reassignedToImporter}) будут записаны на вас.</p> : null}
          {preview.clearedReferences + preview.droppedRows > 0 ? (
            <p>Ссылок без пары в файле: {preview.clearedReferences + preview.droppedRows} — они будут сброшены или не перенесены.</p>
          ) : null}
          {preview.skippedModels.length > 0 ? <p>Не переносится: {preview.skippedModels.join(", ")}.</p> : null}
          {preview.problems.map((problem) => (
            <p key={problem} className="text-destructive">
              {problem}
            </p>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="outline" disabled={!file || importer.isPending} onClick={() => void onPreview()}>
          Проверить файл
        </Button>
        <Button disabled={!preview || preview.problems.length > 0 || importer.isPending} onClick={() => void onApply()}>
          {importer.isPending ? "Переносим…" : "Создать пространство"}
        </Button>
      </div>
    </Card>
  );
}
