"use client";

import { useDeleteTheme, usePreferences, useSaveTheme, useSetWorkspaceTheme, useUpdatePreferences } from "@orion/core-react";
import { DEFAULT_THEME_ID, THEME_LIBRARY_MAX, type WorkspaceThemeMode } from "@orion/shared-types";
import { Badge, Button, ConfirmDialog, SegmentedControl, Select, type ThemeDocument } from "@orion/ui";
import { useId, useState } from "react";
import { resolveApplicationTheme } from "../../lib/effective-application-theme";
import { describeError } from "../../lib/error-message";
import { sameTheme, themeCopy, themeLibraryItems, type ThemeLibraryItem } from "../../lib/theme-library";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { ThemeEditor, type ThemeDraft } from "./theme-preview";

function Swatches({ theme }: { theme: ThemeDocument }): React.ReactElement {
  const c = theme.colors;
  return (
    <span aria-hidden="true" className="flex h-8 w-14 shrink-0 overflow-hidden rounded-md border border-border">
      {[c.canvas, c.surface, c.textPrimary, c.accent].map((color, i) => <span key={i} className="h-full flex-1" style={{ backgroundColor: color }} />)}
    </span>
  );
}

/**
 * Settings → Внешний вид → «Темы»: the library (six built-in palettes and the account's own themes), the editor,
 * and the workspace palette. Which palette shows is decided in one place, `resolveApplicationTheme`.
 */
export function ThemeSettings(): React.ReactElement {
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const saveTheme = useSaveTheme();
  const deleteTheme = useDeleteTheme();
  const { workspace } = useActiveWorkspace();
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  // A new editor instance per opened theme; saving a copy (new → own) keeps the same one and its messages.
  const [editorKey, setEditorKey] = useState(0);
  const [pendingOpen, setPendingOpen] = useState<ThemeDraft | "close" | null>(null);
  const [deleting, setDeleting] = useState<ThemeLibraryItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const data = preferences.data;
  const items = themeLibraryItems(data);
  const ownIds = items.filter(item => item.kind === "own").map(item => item.theme.id);
  const precision = data?.theme === "kaiden-precision";
  const chosenId = data?.activeThemeId ?? DEFAULT_THEME_ID;
  const resolved = resolveApplicationTheme(data, workspace);
  const busy = updatePreferences.isPending || saveTheme.isPending || deleteTheme.isPending;

  /** Opening another theme over unsaved edits asks first; nothing is dropped silently. */
  function open(next: ThemeDraft | "close"): void {
    if (draft?.dirty) { setPendingOpen(next); return; }
    show(next);
  }

  function show(next: ThemeDraft | "close"): void {
    setEditorKey(key => key + 1);
    setDraft(next === "close" ? null : next);
  }

  function report(text: string): void { setError(null); setMessage(text); }
  function fail(prefix: string, failure: unknown): void { setMessage(null); setError(`${prefix} ${describeError(failure)}`); }

  async function apply(item: ThemeLibraryItem): Promise<void> {
    try {
      const confirmed = await updatePreferences.mutateAsync({ theme: "kaiden-precision", activeThemeId: item.theme.id });
      if (confirmed.activeThemeId !== item.theme.id) throw new Error("Сервер не подтвердил выбор темы.");
      report(`Тема «${item.theme.name}» применена.`);
    } catch (failure) { fail("Не удалось применить тему.", failure); }
  }

  async function duplicate(item: ThemeLibraryItem): Promise<void> {
    if (ownIds.length >= THEME_LIBRARY_MAX) { fail("Не удалось создать копию.", new Error(`В библиотеке не больше ${THEME_LIBRARY_MAX} своих тем.`)); return; }
    const copy = themeCopy(item.theme, ownIds);
    try {
      const saved = await saveTheme.mutateAsync({ document: copy, expectedUpdatedAt: null });
      const entry = saved.themeLibrary.find(e => e.document.id === copy.id);
      report(`Создана тема «${copy.name}».`);
      open({ theme: copy, origin: "own", baseUpdatedAt: entry?.updatedAt ?? null, dirty: false });
    } catch (failure) { fail("Не удалось создать копию.", failure); }
  }

  async function confirmDelete(): Promise<void> {
    const item = deleting;
    setDeleting(null);
    if (!item) return;
    const wasActive = data?.activeThemeId === item.theme.id;
    try {
      await deleteTheme.mutateAsync(item.theme.id);
      if (draft?.theme.id === item.theme.id) setDraft(null);
      report(wasActive ? `Тема «${item.theme.name}» удалена. Включена стандартная тема KAIDEN Precision.` : `Тема «${item.theme.name}» удалена.`);
    } catch (failure) { fail("Не удалось удалить тему.", failure); }
  }

  return (
    <details className="border-t border-border pt-3" open>
      <summary className="cursor-pointer text-label text-foreground">Темы</summary>
      <div className="mt-4 min-w-0 space-y-5">
        <section role="region" aria-label="Библиотека тем" className="min-w-0 space-y-3">
          <p className="text-xs text-muted-foreground">
            {resolved ? <>Сейчас применяется «{resolved.theme.name}»{resolved.source === "workspace" ? ", тема пространства" : resolved.source === "default" ? ", стандартная тема" : ""}. </> : "Темы работают в оболочке KAIDEN Precision; «Применить» включит её. "}
            Своих тем можно сохранить до {THEME_LIBRARY_MAX}; они хранятся в учётной записи и доступны на всех устройствах.
          </p>
          <ul className="min-w-0 divide-y divide-border rounded-lg border border-border">
            {items.map(item => {
              const active = precision && chosenId === item.theme.id;
              return (
                <li key={`${item.kind}-${item.theme.id}`} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                  <Swatches theme={item.theme} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate text-label text-foreground" title={item.theme.name}>{item.theme.name}</p>
                    <p className="text-2xs text-muted-foreground">{item.kind === "preset" ? "Встроенная" : "Своя"} · {item.theme.baseMode === "light" ? "светлая" : "тёмная"}</p>
                  </div>
                  {active ? <Badge tone="accent">Выбрана</Badge> : null}
                  {sameTheme(workspace?.theme, item.theme) ? <Badge>В пространстве</Badge> : null}
                  <div className="flex flex-wrap gap-1.5">
                    <Button type="button" size="sm" variant={active ? "subtle" : "outline"} disabled={active || busy}
                      aria-label={`Применить тему «${item.theme.name}»`} onClick={() => void apply(item)}>Применить</Button>
                    <Button type="button" size="sm" variant="subtle" disabled={busy} aria-label={`Открыть тему «${item.theme.name}» в редакторе`}
                      onClick={() => open({ theme: item.theme, origin: item.kind, baseUpdatedAt: item.updatedAt, dirty: false })}>Открыть</Button>
                    <Button type="button" size="sm" variant="subtle" disabled={busy} aria-label={`Дублировать тему «${item.theme.name}»`} onClick={() => void duplicate(item)}>Дублировать</Button>
                    {item.kind === "own" ? <Button type="button" size="sm" variant="subtle" disabled={busy} aria-label={`Удалить тему «${item.theme.name}»`} onClick={() => setDeleting(item)}>Удалить</Button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {message ? <p role="status" className="text-label text-muted-foreground">{message}</p> : null}
          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        </section>
        {draft ? <ThemeEditor key={editorKey} draft={draft} takenIds={ownIds} onChange={setDraft} onClose={() => open("close")} /> : null}
        <WorkspaceThemeSection />
      </div>
      <ConfirmDialog open={pendingOpen !== null} title="Отбросить изменения темы?" confirmLabel="Отбросить"
        description="В редакторе есть несохранённые изменения. Сохраните их или отбросьте."
        onCancel={() => setPendingOpen(null)}
        onConfirm={() => { if (pendingOpen) show(pendingOpen); setPendingOpen(null); }} />
      <ConfirmDialog open={deleting !== null} title="Удалить тему?"
        description={deleting ? `«${deleting.theme.name}» исчезнет из библиотеки на всех устройствах. Пространства, где она выбрана, сохраняют свою копию.` : undefined}
        onCancel={() => setDeleting(null)} onConfirm={() => void confirmDelete()} />
    </details>
  );
}

/**
 * The owner picks a palette for everyone in the space; the server stores a copy, so it does not depend on the
 * owner's own library. Each member separately chooses whether it overrides their own theme.
 */
function WorkspaceThemeSection(): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const setWorkspaceTheme = useSetWorkspaceTheme(workspace?.id);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const ids = useId();
  if (!workspace || !preferences.data) return null;
  const items = themeLibraryItems(preferences.data);
  const owner = workspace.role === "owner";
  const current = items.find(item => sameTheme(item.theme, workspace.theme));
  const selectValue = !workspace.theme ? "" : current ? `${current.kind}:${current.theme.id}` : "workspace";
  const mode = preferences.data.workspaceThemeMode;

  async function choose(value: string): Promise<void> {
    setError(null); setMessage(null);
    const item = items.find(entry => `${entry.kind}:${entry.theme.id}` === value);
    try {
      await setWorkspaceTheme.mutateAsync({ theme: value === "" ? null : (item?.theme ?? null) });
      setMessage(value === "" ? "Тема пространства снята: участники видят свои темы." : `Для пространства выбрана тема «${item?.theme.name}».`);
    } catch (failure) { setError(`Не удалось изменить тему пространства. ${describeError(failure)}`); }
  }

  async function setMode(next: WorkspaceThemeMode): Promise<void> {
    setError(null); setMessage(null);
    try { await updatePreferences.mutateAsync({ workspaceThemeMode: next }); }
    catch (failure) { setError(`Не удалось сохранить выбор. ${describeError(failure)}`); }
  }

  return (
    <section role="region" aria-label="Тема пространства" className="min-w-0 space-y-3 border-t border-border pt-4">
      <p className="text-title">Тема пространства «<span className="break-words">{workspace.name}</span>»</p>
      {owner ? (
        <label className="block min-w-0 space-y-1" htmlFor={`${ids}-workspace`}>
          <span className="text-label">Тема для всех участников</span>
          <Select id={`${ids}-workspace`} value={selectValue} disabled={setWorkspaceTheme.isPending} className="w-full"
            onChange={event => void choose(event.target.value)}>
            <option value="">Без темы пространства</option>
            {selectValue === "workspace" && workspace.theme ? <option value="workspace">{workspace.theme.name} (сохранённая копия)</option> : null}
            {items.map(item => <option key={`${item.kind}:${item.theme.id}`} value={`${item.kind}:${item.theme.id}`}>{item.theme.name}{item.kind === "own" ? " (своя)" : ""}</option>)}
          </Select>
        </label>
      ) : (
        <p className="text-xs text-muted-foreground">
          {workspace.theme ? `Владелец выбрал для пространства тему «${workspace.theme.name}».` : "Владелец не выбирал тему для этого пространства."} Менять её может только владелец.
        </p>
      )}
      <div className="space-y-1">
        <p className="text-label" id={`${ids}-mode`}>Что показывать мне</p>
        <SegmentedControl<WorkspaceThemeMode> aria-label="Что показывать мне" value={mode} onChange={next => void setMode(next)}
          options={[{ value: "follow", label: "Тему пространства" }, { value: "personal", label: "Всегда мою тему" }]} />
        <p className="text-2xs text-muted-foreground">Выбор относится только к вам. Если у пространства нет темы, всегда показывается ваша.</p>
      </div>
      {message ? <p role="status" className="text-label text-muted-foreground">{message}</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </section>
  );
}
