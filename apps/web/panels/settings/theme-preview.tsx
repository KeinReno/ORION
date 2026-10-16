"use client";

import {
  ARCTIC_THEME, Button, Input, MAX_THEME_JSON_LENGTH, Modal, PRECISION_THEME,
  Select, Textarea, ThemeProvider, Tooltip, exportThemeDocument, parseThemeDocument,
  themeTextContrast, useToast, withThemeColor, type ThemeColor, type ThemeDocument
} from "@orion/ui";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

const EDITABLE_COLORS: { key: ThemeColor; label: string }[] = [
  { key: "canvas", label: "Холст" }, { key: "surface", label: "Поверхность" },
  { key: "textPrimary", label: "Основной текст" }, { key: "accent", label: "Акцент" }
];

function ThemeSample({ preview, onCancel }: { preview: boolean; onCancel: () => void }): React.ReactElement {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const fieldId = useId();
  return (
    <div className="space-y-4 rounded-lg p-4" style={{ backgroundColor: "rgb(var(--kaiden-bg-surface))" }}>
      <p className="text-title">Образец</p>
      <label className="block space-y-1" htmlFor={`${fieldId}-name`}>
        <span className="text-label">Название образца</span>
        <Input id={`${fieldId}-name`} name="theme-sample-name" defaultValue="Рабочая заметка" />
      </label>
      <label className="block space-y-1" htmlFor={`${fieldId}-body`}>
        <span className="text-label">Текст образца</span>
        <Textarea id={`${fieldId}-body`} name="theme-sample-body" rows={2} placeholder="Напишите несколько строк" />
      </label>
      <label className="block space-y-1" htmlFor={`${fieldId}-status`}>
        <span className="text-label">Статус образца</span>
        <Select id={`${fieldId}-status`} name="theme-sample-status" defaultValue="active" className="w-full">
          <option value="active">В работе</option><option value="done">Готово</option>
        </Select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setOpen(true)}>Открыть диалог</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => toast({ title: "Проверочное уведомление", description: "Оформление этой области" })}>Показать уведомление</Button>
        <Tooltip label="Подсказка в теме образца"><Button type="button" size="sm" variant="subtle">Подсказка</Button></Tooltip>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Диалог образца"
        footer={<><Button type="button" size="sm" variant="outline" disabled={!preview} onClick={onCancel}>Отменить предпросмотр</Button><Button type="button" size="sm" onClick={() => setOpen(false)}>Закрыть диалог</Button></>}>
        <label className="block space-y-1" htmlFor={`${fieldId}-draft`}>
          <span className="text-label">Черновик образца</span>
          <Input id={`${fieldId}-draft`} name="theme-sample-draft" defaultValue="Мой черновик" />
        </label>
      </Modal>
    </div>
  );
}

/** Ephemeral Theme Engine slice. No preferences mutation or storage writes. */
export function ThemePreview(): React.ReactElement {
  const [selected, setSelected] = useState("precision");
  const [custom, setCustom] = useState<ThemeDocument | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importSequence = useRef(0);
  useEffect(() => () => { ++importSequence.current; }, []);
  const ids = useId();
  const theme = selected === "custom" && custom ? custom : selected === "arctic" ? ARCTIC_THEME : PRECISION_THEME;
  const contrast = themeTextContrast(theme);

  async function importTheme(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const sequence = ++importSequence.current;
    setError(null);
    if (file.size > MAX_THEME_JSON_LENGTH) { setError("Файл темы слишком большой (максимум 16 КБ)."); return; }
    setImporting(true);
    try {
      const parsed = parseThemeDocument(await file.text());
      if (sequence !== importSequence.current) return;
      if (!parsed.ok) { setError(parsed.error); return; }
      setCustom(parsed.value);
      setSelected("custom");
    } catch { if (sequence === importSequence.current) setError("Не удалось прочитать файл темы."); }
    finally { if (sequence === importSequence.current) setImporting(false); }
  }

  function exportTheme(): void {
    const url = URL.createObjectURL(new Blob([exportThemeDocument(theme)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${theme.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <details className="border-t border-border pt-3">
      <summary className="cursor-pointer text-label text-foreground">Предпросмотр тем</summary>
      <div className="mt-4 space-y-4" role="region" aria-label="Предпросмотр тем">
        <p className="text-xs text-muted-foreground">Палитра применяется только к образцу ниже. Копия хранится до выхода из раздела «Внешний вид»; экспортируйте её, чтобы сохранить.</p>
        <label className="block space-y-1" htmlFor={`${ids}-preset`}>
          <span className="text-label">Палитра образца</span>
          <Select id={`${ids}-preset`} name="theme-preview-preset" value={selected} onChange={event => { ++importSequence.current; setImporting(false); setSelected(event.target.value); setError(null); }} className="w-full">
            <option value="precision">KAIDEN Precision</option><option value="arctic">Arctic (светлая)</option>
            {custom ? <option value="custom">{custom.name}</option> : null}
          </Select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={selected === "custom"} onClick={() => {
            ++importSequence.current; setImporting(false);
            setCustom({ ...theme, id: `custom-${Date.now().toString(36)}`, name: `${theme.name} — копия`.slice(0, 80), colors: { ...theme.colors } });
            setSelected("custom"); setError(null);
          }}>{custom && selected !== "custom" ? "Заменить копию" : "Создать копию"}</Button>
          <Button type="button" size="sm" variant="outline" onClick={exportTheme}>Экспортировать тему</Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {EDITABLE_COLORS.map(({ key, label }) => <label key={key} className="block space-y-1" htmlFor={`${ids}-${key}`}>
            <span className="text-label">{label}</span>
            <Input id={`${ids}-${key}`} name={`theme-color-${key}`} type="color" disabled={selected !== "custom"} value={theme.colors[key]} className="h-9 p-1"
              onChange={event => { ++importSequence.current; setImporting(false); setCustom(current => current ? withThemeColor(current, key, event.target.value) : null); }} />
          </label>)}
        </div>
        <label className="block space-y-1" htmlFor={`${ids}-import`}>
          <span className="text-label">Импортировать файл темы (.json)</span>
          <Input id={`${ids}-import`} name="theme-preview-import" type="file" accept=".json,application/json" disabled={importing} onChange={event => { void importTheme(event); }} />
        </label>
        {error ? <p role="alert" className="text-xs text-destructive">{error} Предыдущая палитра сохранена.</p> : null}
        <p className="text-xs text-muted-foreground">Контраст основного текста: {contrast.toFixed(1)}:1.{contrast < 4.5 ? " Ниже 4.5:1 — измените текст или поверхность." : ""}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setPreview(value => !value)}>{preview ? "Отменить предпросмотр" : "Включить предпросмотр"}</Button>
          <Button type="button" size="sm" variant="subtle" onClick={() => { ++importSequence.current; setImporting(false); setSelected("precision"); setCustom(null); setPreview(false); setError(null); }}>Сбросить образец</Button>
        </div>
        <ThemeProvider inherit={!preview} flag={preview ? "kaiden-theme-v1" : undefined} definition={theme} className="rounded-lg border p-4"
          style={{ backgroundColor: "rgb(var(--kaiden-bg-canvas))", color: "rgb(var(--kaiden-text-primary))", borderColor: "rgb(var(--kaiden-border-default))" }}>
          <ThemeSample preview={preview} onCancel={() => setPreview(false)} />
        </ThemeProvider>
      </div>
    </details>
  );
}
