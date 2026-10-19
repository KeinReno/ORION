"use client";

import { usePreferences, useUpdatePreferences } from "@orion/core-react";
import type { UserPreference } from "@orion/shared-types";
import { Button, Sheet, Switch, useToast } from "@orion/ui";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { getPanelDefinition, panelKind } from "../lib/panel-registry";
import { PluginsSettings } from "../panels/settings/plugins-section";

/**
 * Per-module settings: only what belongs to this module — its own personal options (when it has
 * any) and its plugins (workspace-wide, owner only). The look of the app (accent, density, menu
 * edge) is global and lives in Settings → «Внешний вид»; showing it here under «Настройки: Задачи»
 * suggested a per-module colour that never existed.
 */
export function ModuleSettingsSheet({
  panelId,
  open,
  onClose,
  onOpenAppearance
}: {
  panelId: string | null;
  open: boolean;
  onClose: () => void;
  onOpenAppearance: () => void;
}): React.ReactElement {
  const definition = panelId ? getPanelDefinition(panelId) : undefined;
  const { workspace } = useActiveWorkspace();
  const preferences = usePreferences().data;
  const update = useUpdatePreferences();
  const { toast } = useToast();
  const kind = panelId ? panelKind(panelId) : null;

  function change(patch: Partial<UserPreference>): void {
    update.mutate(patch, { onError: () => toast({ title: "Не удалось сохранить", tone: "danger" }) });
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Настройки: ${definition?.label ?? "модуль"}`} width="30rem">
      <div className="space-y-6">
        {(kind === "notes" || kind === "note") && preferences ? (
          <section aria-labelledby="module-own" className="space-y-3">
            <div>
              <h3 id="module-own" className="text-sm font-medium text-foreground">
                Отображение
              </h3>
              <p className="text-2xs text-subtle-foreground">Только для вас.</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Номера заметок вида N-104 — в списке и в заметке, для ссылок и поиска по номеру
              </span>
              <Switch label="Номера заметок" checked={preferences.showNoteIds} onChange={(showNoteIds) => change({ showNoteIds })} />
            </div>
          </section>
        ) : null}
        <section aria-labelledby="module-plugins" className="space-y-3">
          <div>
            <h3 id="module-plugins" className="text-sm font-medium text-foreground">
              Плагины
            </h3>
            {definition?.moduleId ? (
              <p className="text-2xs text-subtle-foreground">
                Для всех участников{workspace ? ` «${workspace.name}»` : " пространства"}; меняет владелец.
              </p>
            ) : null}
          </div>
          {definition?.moduleId ? (
            <PluginsSettings moduleId={definition.moduleId} />
          ) : (
            <p className="text-xs text-muted-foreground">Это часть оболочки приложения, у неё нет плагинов.</p>
          )}
        </section>
        <section className="space-y-2 border-t border-border pt-4">
          <p className="text-2xs text-subtle-foreground">
            Акцент, плотность, положение меню и фон действуют на всё приложение — они в общих настройках.
          </p>
          <Button size="sm" variant="outline" onClick={onOpenAppearance}>
            Внешний вид приложения
          </Button>
        </section>
      </div>
    </Sheet>
  );
}
