"use client";

import { Button, Input, Modal, Textarea } from "@orion/ui";
import { Check, Download, Star, Trash2, Pencil } from "lucide-react";
import { useState } from "react";
import {
  LAYOUT_NAME_MAX,
  LAYOUT_SHORTCUT_COUNT,
  cleanLayoutName,
  type LayoutImportResult
} from "../lib/named-layouts";

/**
 * Management of a workspace's named layouts: default-on-entry marker, rename, delete and
 * JSON export / import. Applying and saving stay in the «Раскладки» menu.
 */
export function LayoutsDialog({
  open,
  onClose,
  names,
  defaultName,
  onSetDefault,
  onRename,
  onDelete,
  onExport,
  onImport
}: {
  open: boolean;
  onClose: () => void;
  names: string[];
  defaultName: string | null;
  onSetDefault: (name: string | null) => void;
  onRename: (from: string, to: string) => boolean;
  onDelete: (name: string) => void;
  onExport: () => string;
  onImport: (text: string) => LayoutImportResult;
}): React.ReactElement {
  const [editing, setEditing] = useState<{ from: string; value: string } | null>(null);
  const [renameError, setRenameError] = useState(false);
  const [importText, setImportText] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function submitRename(): void {
    if (!editing) return;
    if (onRename(editing.from, editing.value)) {
      setEditing(null);
      setRenameError(false);
    } else {
      setRenameError(true);
    }
  }

  function download(): void {
    try {
      const blob = new Blob([onExport()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "orion-layouts.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage({ tone: "ok", text: "Раскладки сохранены в файл." });
    } catch {
      setMessage({ tone: "error", text: "Не удалось создать файл." });
    }
  }

  function runImport(text: string): void {
    const result = onImport(text);
    if (result.ok) {
      setImportText("");
      setMessage({
        tone: "ok",
        text: `Импортировано: ${result.added}, заменено: ${result.replaced}${result.skipped ? `, пропущено: ${result.skipped}` : ""}.`
      });
    } else {
      setMessage({ tone: "error", text: result.error ?? "Не удалось импортировать." });
    }
  }

  function readFile(file: File | undefined): void {
    if (!file) return;
    file
      .text()
      .then(runImport)
      .catch(() => setMessage({ tone: "error", text: "Не удалось прочитать файл." }));
  }

  return (
    <Modal open={open} onClose={onClose} title="Раскладки" size="md">
      <div className="flex flex-col gap-4 text-sm">
        {names.length === 0 ? (
          <p className="text-muted-foreground">Раскладок пока нет. Расставьте панели и выберите «Сохранить текущую…».</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {names.map((name, index) => (
              <li key={name} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-white/5">
                <span className="w-12 shrink-0 text-2xs text-subtle-foreground">
                  {index < LAYOUT_SHORTCUT_COUNT ? `Alt+${index + 1}` : ""}
                </span>
                {editing?.from === name ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitRename();
                    }}
                  >
                    <Input
                      value={editing.value}
                      maxLength={LAYOUT_NAME_MAX}
                      aria-label="Новое название раскладки"
                      aria-invalid={renameError}
                      autoFocus
                      onChange={(event) => {
                        setRenameError(false);
                        setEditing({ from: name, value: event.target.value });
                      }}
                    />
                    <Button type="submit" size="sm" disabled={!cleanLayoutName(editing.value)} aria-label="Применить название">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-foreground">{name}</span>
                )}
                <button
                  type="button"
                  title={defaultName === name ? "Открывается при входе в пространство (нажмите, чтобы снять)" : "Открывать при входе в это пространство"}
                  aria-label={defaultName === name ? "Снять «открывать при входе»" : "Открывать при входе"}
                  aria-pressed={defaultName === name}
                  onClick={() => onSetDefault(defaultName === name ? null : name)}
                  className="flex h-7 w-7 items-center justify-center rounded text-subtle-foreground hover:bg-white/10 hover:text-foreground"
                >
                  <Star className={defaultName === name ? "h-4 w-4 fill-current text-accent" : "h-4 w-4"} />
                </button>
                <button
                  type="button"
                  title="Переименовать"
                  aria-label={`Переименовать «${name}»`}
                  onClick={() => {
                    setRenameError(false);
                    setEditing({ from: name, value: name });
                  }}
                  className="flex h-7 w-7 items-center justify-center rounded text-subtle-foreground hover:bg-white/10 hover:text-foreground"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Удалить"
                  aria-label={`Удалить «${name}»`}
                  onClick={() => onDelete(name)}
                  className="flex h-7 w-7 items-center justify-center rounded text-subtle-foreground hover:bg-destructive/20 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {renameError ? <p className="text-xs text-destructive">Название пустое или уже занято.</p> : null}

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">Перенос</span>
            <Button type="button" variant="outline" size="sm" disabled={names.length === 0} onClick={download}>
              <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
              Экспорт в файл
            </Button>
          </div>
          <Textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={4}
            placeholder="Вставьте JSON раскладок для импорта"
            aria-label="JSON раскладок для импорта"
          />
          <div className="flex items-center justify-between gap-2">
            <label className="cursor-pointer text-xs text-muted-foreground underline hover:text-foreground">
              или выбрать файл
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => {
                  readFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <Button type="button" size="sm" disabled={!importText.trim()} onClick={() => runImport(importText)}>
              Импортировать
            </Button>
          </div>
          {message ? (
            <p role="status" className={message.tone === "ok" ? "text-xs text-success" : "text-xs text-destructive"}>
              {message.text}
            </p>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
