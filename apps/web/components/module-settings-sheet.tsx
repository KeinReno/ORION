"use client";

import { usePreferences, useUpdatePreferences } from "@orion/core-react";
import type { UserPreference } from "@orion/shared-types";
import { Button, SegmentedControl, Sheet, useToast } from "@orion/ui";
import { ACCENT_OPTIONS } from "../lib/accent-options";
import { getPanelDefinition } from "../lib/panel-registry";
import { PluginsSettings } from "../panels/settings/plugins-section";

/**
 * Per-module settings: the module's plugins (workspace-wide, owner only) and the look of the
 * app (personal). The look is global in ORION — accent, density and menu edge apply to every
 * panel — so the controls here are the same ones as in Settings, applied at once, not a
 * second, module-only set of colours.
 */
export function ModuleSettingsSheet({
  panelId,
  open,
  onClose,
  onOpenAllSettings
}: {
  panelId: string | null;
  open: boolean;
  onClose: () => void;
  onOpenAllSettings: () => void;
}): React.ReactElement {
  const definition = panelId ? getPanelDefinition(panelId) : undefined;
  const preferences = usePreferences().data;
  const update = useUpdatePreferences();
  const { toast } = useToast();

  function change(patch: Partial<UserPreference>): void {
    update.mutate(patch, { onError: () => toast({ title: "Не удалось сохранить", tone: "danger" }) });
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Настройки: ${definition?.label ?? "модуль"}`} width="30rem">
      <div className="space-y-6">
        <section aria-labelledby="module-look" className="space-y-3">
          <h3 id="module-look" className="text-sm font-medium text-foreground">
            Внешний вид
          </h3>
          <p className="text-2xs text-subtle-foreground">Действует на всё приложение и только для вас.</p>
          {preferences ? (
            <>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Акцент</p>
                <SegmentedControl<UserPreference["accent"]> value={preferences.accent} onChange={(accent) => change({ accent })} options={ACCENT_OPTIONS} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Плотность</p>
                <SegmentedControl<UserPreference["density"]>
                  value={preferences.density}
                  onChange={(density) => change({ density })}
                  options={[
                    { value: "compact", label: "Компактная" },
                    { value: "comfortable", label: "Свободная" }
                  ]}
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Положение меню</p>
                <SegmentedControl<UserPreference["sidebarPosition"]>
                  value={preferences.sidebarPosition}
                  onChange={(sidebarPosition) => change({ sidebarPosition })}
                  options={[
                    { value: "left", label: "Слева" },
                    { value: "right", label: "Справа" },
                    { value: "top", label: "Сверху" },
                    { value: "bottom", label: "Снизу" }
                  ]}
                />
              </div>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={onOpenAllSettings}>
            Все настройки внешнего вида
          </Button>
        </section>
        <section aria-labelledby="module-plugins" className="space-y-3">
          <h3 id="module-plugins" className="text-sm font-medium text-foreground">
            Плагины
          </h3>
          {definition?.moduleId ? (
            <PluginsSettings moduleId={definition.moduleId} />
          ) : (
            <p className="text-xs text-muted-foreground">Это часть оболочки приложения, у неё нет плагинов.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
