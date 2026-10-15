"use client";

import { useImportContactCards } from "@orion/core-react";
import { contactsToCsv, contactsToVCard, parseContactsCsv, parseVCards, type ContactCard, type CreateContactCardInput } from "@orion/shared-types";
import { Button, Modal, Select, Switch, useToast } from "@orion/ui";
import { Download, FileUp } from "lucide-react";
import { useRef, useState } from "react";
import { describeError } from "../../lib/error-message";

type ExportScope = "visible" | "active" | "selected";

function download(filename: string, text: string, mime: string, bom = false): void {
  const blob = new Blob([bom ? "﻿" : "", text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Import (.vcf / .csv from a phone, Google or Excel) and export of contacts. */
export function ContactsIo({
  open,
  onClose,
  workspaceId,
  visible,
  active,
  selected
}: {
  open: boolean;
  onClose: () => void;
  workspaceId: string | undefined;
  /** What the list currently shows (filters applied). */
  visible: ContactCard[];
  /** Every non-archived contact. */
  active: ContactCard[];
  /** Currently ticked contacts. */
  selected: ContactCard[];
}): React.ReactElement {
  const { toast } = useToast();
  const importer = useImportContactCards(workspaceId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<CreateContactCardInput[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [scope, setScope] = useState<ExportScope>(selected.length > 0 ? "selected" : "visible");

  async function readFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = /\.vcf$/i.test(file.name) || /BEGIN:VCARD/i.test(text.slice(0, 2000)) ? parseVCards(text) : parseContactsCsv(text);
      setFileName(file.name);
      setItems(parsed);
      if (parsed.length === 0) toast({ title: "В файле нет контактов", description: "Поддерживаются .vcf и .csv (в том числе экспорт Google Контактов).", tone: "default" });
    } catch (error) {
      toast({ title: "Не удалось прочитать файл", description: describeError(error), tone: "danger" });
    }
  }

  async function runImport(): Promise<void> {
    try {
      // The API takes up to 2000 rows per call; a larger address book goes in slices.
      let created = 0;
      let skipped = 0;
      for (let start = 0; start < items.length; start += 2000) {
        const result = await importer.mutateAsync({ items: items.slice(start, start + 2000), skipDuplicates });
        created += result.created;
        skipped += result.skipped;
      }
      toast({ title: `Импортировано: ${created}`, description: skipped > 0 ? `Пропущено повторов: ${skipped}` : undefined, tone: "success" });
      setItems([]);
      setFileName("");
      if (fileRef.current) fileRef.current.value = "";
      onClose();
    } catch (error) {
      toast({ title: "Не удалось импортировать", description: describeError(error), tone: "danger" });
    }
  }

  const exportList = scope === "selected" ? selected : scope === "active" ? active : visible;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <Modal open={open} onClose={onClose} title="Импорт и экспорт" size="md">
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-label text-foreground">
            <FileUp className="h-4 w-4 text-subtle-foreground" /> Импорт
          </h3>
          <p className="text-2xs text-subtle-foreground">Файл .vcf (телефон, iCloud, Google) или .csv (экспорт Google Контактов, Excel). Ничего не удаляется — контакты только добавляются.</p>
          <input ref={fileRef} type="file" accept=".vcf,.csv,text/vcard,text/csv" aria-label="Файл контактов" onChange={(event) => void readFile(event.target.files?.[0])} className="text-label text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-transparent file:px-3 file:py-1.5 file:text-label file:text-foreground" />
          {items.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border bg-white/[0.02] p-3">
              <p className="text-label text-foreground">
                {fileName}: найдено {items.length}
              </p>
              <p className="truncate text-2xs text-subtle-foreground">{items.slice(0, 5).map((item) => item.name).join(", ")}{items.length > 5 ? "…" : ""}</p>
              <label className="flex items-center justify-between gap-2 text-label text-muted-foreground">
                Пропускать похожие на уже существующие
                <Switch checked={skipDuplicates} onChange={setSkipDuplicates} label="Пропускать повторы" />
              </label>
              <Button type="button" size="sm" className="self-start" disabled={importer.isPending || workspaceId === undefined} onClick={() => void runImport()}>
                Импортировать {items.length}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 text-label text-foreground">
            <Download className="h-4 w-4 text-subtle-foreground" /> Экспорт
          </h3>
          <Select value={scope} onChange={(event) => setScope(event.target.value as ExportScope)} aria-label="Что экспортировать">
            <option value="visible">Показанные сейчас ({visible.length})</option>
            <option value="active">Все активные ({active.length})</option>
            {selected.length > 0 ? <option value="selected">Выбранные ({selected.length})</option> : null}
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={exportList.length === 0} onClick={() => download(`contacts-${stamp}.vcf`, contactsToVCard(exportList), "text/vcard")}>
              vCard (.vcf)
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={exportList.length === 0} onClick={() => download(`contacts-${stamp}.csv`, contactsToCsv(exportList), "text/csv", true)}>
              Таблица (.csv)
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
