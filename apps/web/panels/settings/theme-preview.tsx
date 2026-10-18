"use client";

import { useSaveTheme, useUpdatePreferences } from "@orion/core-react";
import type { UserPreference } from "@orion/shared-types";
import {
  Button, Input, MAX_THEME_JSON_LENGTH, Modal, Select, Textarea, ThemeProvider, Tooltip, exportThemeDocument,
  parseThemeDocument, themeBlockingContrastIssue, themeContrastChecks, useToast, withThemeColor,
  type ThemeColor, type ThemeDocument
} from "@orion/ui";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { describeError } from "../../lib/error-message";
import { importedTheme, themeConflict, themeCopy } from "../../lib/theme-library";

const MAIN_COLORS: { key: ThemeColor; label: string }[] = [
  { key: "canvas", label: "Холст" }, { key: "surface", label: "Поверхность" },
  { key: "textPrimary", label: "Основной текст" }, { key: "accent", label: "Акцент" }
];
const EXTRA_COLORS: { key: ThemeColor; label: string }[] = [
  { key: "elevated", label: "Приподнятая поверхность" }, { key: "hover", label: "Наведение" },
  { key: "textSecondary", label: "Второстепенный текст" }, { key: "textSubtle", label: "Приглушённый текст" },
  { key: "border", label: "Граница" }, { key: "borderStrong", label: "Заметная граница" },
  { key: "accentHover", label: "Акцент при наведении" }, { key: "accentForeground", label: "Текст на акценте" },
  { key: "focus", label: "Рамка фокуса" }, { key: "success", label: "Успех" }, { key: "warning", label: "Предупреждение" },
  { key: "danger", label: "Ошибка" }, { key: "info", label: "Сведения" }, { key: "tint", label: "Оттенок слоёв" }
];

/**
 * What the editor holds. `preset` is a built-in palette opened for a look (it can be applied but not saved;
 * the first edit turns it into a new copy); `own` is a library theme, saved against `baseUpdatedAt`;
 * `new` is a copy, an import or a fresh theme that is not in the library yet.
 */
export interface ThemeDraft {
  theme: ThemeDocument;
  origin: "preset" | "own" | "new";
  baseUpdatedAt: string | null;
  dirty: boolean;
}

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
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-label">
        <span className="text-success">Готово</span><span className="text-warning">Скоро срок</span><span className="text-destructive">Просрочено</span>
      </p>
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

function ColorField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }): React.ReactElement {
  return (
    <label className="block min-w-0 space-y-1" htmlFor={id}>
      <span className="text-label">{label}</span>
      <input id={id} type="color" aria-label={label} value={value} onChange={event => onChange(event.target.value)}
        className="block h-9 w-14 cursor-pointer rounded-lg border border-ui-border bg-transparent p-1" />
    </label>
  );
}

/**
 * Edits one theme. The sample below previews it in its own scope; the rest of the app changes only after an
 * explicit save-and-apply, so trying colours never writes anything. A save names the revision it started from,
 * and an edit made meanwhile on another device is shown as a conflict instead of being overwritten.
 */
export function ThemeEditor({ draft, takenIds, onChange, onClose }: {
  draft: ThemeDraft;
  /** Ids already used by own themes, so a copy or an import never collides with them. */
  takenIds: string[];
  onChange: (draft: ThemeDraft) => void;
  onClose: () => void;
}): React.ReactElement {
  const saveTheme = useSaveTheme();
  const updatePreferences = useUpdatePreferences();
  const [preview, setPreview] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ReturnType<typeof themeConflict>>(null);
  const [importing, setImporting] = useState(false);
  const importSequence = useRef(0);
  useEffect(() => () => { ++importSequence.current; }, []);
  const ids = useId();
  const theme = draft.theme;
  const checks = themeContrastChecks(theme);
  const blocking = themeBlockingContrastIssue(theme);
  const valid = parseThemeDocument(theme);
  const busy = saveTheme.isPending || updatePreferences.isPending || importing;

  /** Any change to a built-in palette edits a copy of it, so presets stay as they ship. */
  function edit(next: ThemeDocument): void {
    ++importSequence.current; setImporting(false); setMessage(null); setError(null); setConflict(null); setPreview(true);
    if (draft.origin === "preset") {
      const copy = themeCopy(draft.theme, takenIds);
      onChange({ theme: { ...next, id: copy.id, name: next.name === draft.theme.name ? copy.name : next.name }, origin: "new", baseUpdatedAt: null, dirty: true });
    } else onChange({ ...draft, theme: next, dirty: true });
  }

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
      onChange({ theme: importedTheme(parsed.value, takenIds), origin: "new", baseUpdatedAt: null, dirty: true });
      setMessage(null);
      setPreview(true);
    } catch { if (sequence === importSequence.current) setError("Не удалось прочитать файл темы."); }
    finally { if (sequence === importSequence.current) setImporting(false); }
  }

  /** `force` overwrites whatever is stored: the user chose "keep mine" after a conflict. */
  async function save(apply: boolean, force = false): Promise<void> {
    setMessage(null); setError(null);
    if (!valid.ok) { setError(valid.error); return; }
    if (blocking) { setError(`Тема плохо читается. ${blocking}`); return; }
    try {
      let saved: UserPreference | null = null;
      if (draft.origin !== "preset" && (draft.dirty || draft.origin === "new" || force)) {
        saved = await saveTheme.mutateAsync({
          document: valid.value,
          ...(force ? {} : { expectedUpdatedAt: draft.origin === "own" ? draft.baseUpdatedAt : null })
        });
        const entry = saved.themeLibrary.find(e => e.document.id === valid.value.id);
        if (!entry) throw new Error("Сервер не подтвердил запись темы.");
        onChange({ theme: valid.value, origin: "own", baseUpdatedAt: entry.updatedAt, dirty: false });
        setConflict(null);
      }
      if (apply) {
        const confirmed = await updatePreferences.mutateAsync({ theme: "kaiden-precision", activeThemeId: valid.value.id });
        if (confirmed.activeThemeId !== valid.value.id || confirmed.theme !== "kaiden-precision") throw new Error("Сервер не подтвердил выбор темы.");
        setMessage(saved ? "Тема сохранена в вашей библиотеке и применена." : "Тема применена.");
      } else setMessage("Тема сохранена в вашей библиотеке.");
    } catch (failure) {
      const found = themeConflict(failure);
      if (found) { setConflict(found); return; }
      setError(`Не удалось сохранить тему. ${describeError(failure)}`);
    }
  }

  function loadServerVersion(): void {
    if (!conflict) return;
    if (conflict.current) onChange({ theme: conflict.current.document as ThemeDocument, origin: "own", baseUpdatedAt: conflict.current.updatedAt, dirty: false });
    else onChange({ ...draft, origin: "new", baseUpdatedAt: null });
    setConflict(null);
  }

  function exportTheme(): void {
    if (!valid.ok) { setError(valid.error); return; }
    const url = URL.createObjectURL(new Blob([exportThemeDocument(valid.value)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${valid.value.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const canSave = draft.origin !== "preset" && valid.ok && !blocking && !busy;
  return (
    <section className="space-y-4 rounded-lg border border-border p-3 sm:p-4" role="region" aria-label="Редактор темы">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-title">Редактор темы</p>
          <p className="text-xs text-muted-foreground">
            {draft.origin === "preset" ? "Встроенная тема. Измените любой цвет, и появится ваша копия; саму встроенную тему изменить нельзя." :
              draft.origin === "new" ? "Новая тема. Она появится в библиотеке после сохранения." :
                draft.dirty ? "Есть несохранённые изменения." : "Сохранено в вашей библиотеке."}
          </p>
        </div>
        <Button type="button" size="sm" variant="subtle" onClick={onClose}>Закрыть редактор</Button>
      </div>
      <fieldset disabled={saveTheme.isPending || updatePreferences.isPending} className="min-w-0 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1" htmlFor={`${ids}-name`}>
            <span className="text-label">Название темы</span>
            <Input id={`${ids}-name`} value={theme.name} maxLength={80} onChange={event => edit({ ...theme, name: event.target.value })} />
          </label>
          <label className="block min-w-0 space-y-1" htmlFor={`${ids}-base`}>
            <span className="text-label">Основа</span>
            <Select id={`${ids}-base`} value={theme.baseMode} className="w-full"
              onChange={event => edit({ ...theme, baseMode: event.target.value === "light" ? "light" : "dark" })}>
              <option value="dark">Тёмная</option><option value="light">Светлая</option>
            </Select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {MAIN_COLORS.map(({ key, label }) => <ColorField key={key} id={`${ids}-${key}`} label={label} value={theme.colors[key]} onChange={value => edit(withThemeColor(theme, key, value))} />)}
        </div>
        <details>
          <summary className="cursor-pointer text-label text-foreground">Все цвета</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {EXTRA_COLORS.map(({ key, label }) => <ColorField key={key} id={`${ids}-${key}`} label={label} value={theme.colors[key]} onChange={value => edit(withThemeColor(theme, key, value))} />)}
          </div>
        </details>
        <div className="space-y-1">
          <p className="text-label">Читаемость</p>
          <ul className="space-y-0.5 text-xs" aria-label="Проверка контраста">
            {checks.map(check => (
              <li key={check.id} className={check.ok ? "text-muted-foreground" : check.blocking ? "text-destructive" : "text-warning"}>
                {check.ok ? "✓" : "!"} {check.label}: {check.ratio.toFixed(1)}:1{check.ok ? "" : ` (нужно ${check.minimum}:1${check.blocking ? ", без этого тему не сохранить" : ""})`}
              </li>
            ))}
          </ul>
        </div>
        <label className="block space-y-1" htmlFor={`${ids}-import`}>
          <span className="text-label">Импортировать файл темы (.json)</span>
          <Input id={`${ids}-import`} type="file" accept=".json,application/json" disabled={importing} onChange={event => { void importTheme(event); }} />
        </label>
        {conflict ? (
          <div role="alert" className="space-y-2 rounded-lg border border-warning/40 p-3 text-xs">
            <p>{conflict.current ? "Эту тему уже изменили на другом устройстве." : "Эту тему удалили на другом устройстве."} Ваши изменения пока не сохранены.</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={loadServerVersion}>{conflict.current ? "Загрузить версию сервера" : "Оставить как новую тему"}</Button>
              <Button type="button" size="sm" onClick={() => void save(false, true)}>{conflict.current ? "Сохранить мою поверх" : "Сохранить заново"}</Button>
            </div>
          </div>
        ) : null}
        {message ? <p role="status" className="text-label text-muted-foreground">{message}</p> : null}
        {error ? <p role="alert" className="text-xs text-destructive">{error} Применённая тема не изменилась.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!valid.ok || !!blocking || busy} onClick={() => void save(true)}>{saveTheme.isPending || updatePreferences.isPending ? "Сохраняю…" : draft.origin === "preset" ? "Применить" : "Сохранить и применить"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={!canSave} onClick={() => void save(false)}>Сохранить</Button>
          <Button type="button" size="sm" variant="outline" onClick={exportTheme}>Экспортировать тему</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setPreview(value => !value)}>{preview ? "Отменить предпросмотр" : "Включить предпросмотр"}</Button>
        </div>
        <ThemeProvider inherit={!preview} flag={preview ? "kaiden-theme-v1" : undefined} definition={theme} className="rounded-lg border p-3 sm:p-4"
          style={{ backgroundColor: "rgb(var(--kaiden-bg-canvas))", color: "rgb(var(--kaiden-text-primary))", borderColor: "rgb(var(--kaiden-border-default))" }}>
          <ThemeSample preview={preview} onCancel={() => setPreview(false)} />
        </ThemeProvider>
      </fieldset>
    </section>
  );
}
