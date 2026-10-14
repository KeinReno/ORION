"use client";

import { isPluginEnabled } from "@orion/shared-types";
import { EmptyState, PanelBody, PanelShell } from "@orion/ui";
import { PanelTop } from "lucide-react";
import { panelRegistry, type PanelComponentProps } from "../lib/panel-registry";
import { parseSectionViewInstance } from "../lib/section-views";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";

/**
 * One tab of a section panel as a panel of its own (dock tab or OS window). The id is
 * `view:<base>~<view>[~<instance>]` (see `lib/section-views.ts`). This host does not draw anything
 * itself: it renders the section panel (`finance`, `home`, `project`, …) LOCKED to that tab, so the
 * tab shows the very same component, data and actions as inside the section — nothing is copied.
 * Module / plugin switches are re-checked here: a saved id grants nothing.
 */
export function SectionViewPanel({ params, api }: PanelComponentProps): React.ReactElement {
  const ref = parseSectionViewInstance(params?.instanceId);
  const { workspace } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  // The base is looked up by kind only: a section about a record (a project) is `instanced`, one that is
  // not (finance) is not, and both are valid hosts here.
  const base = ref ? panelRegistry.find((panel) => panel.id === ref.base) : undefined;

  if (!ref || !base || ref.base === "view") {
    return <Unavailable text="Эта вкладка недоступна: раздел не найден." />;
  }
  if (base.moduleId && !isEnabled(base.moduleId)) {
    return <Unavailable text={`Модуль «${base.label}» выключен в этом пространстве. Данные сохранены — включите его в Настройках.`} />;
  }
  if (base.pluginId && !isPluginEnabled(workspace?.pluginOverrides ?? [], base.pluginId)) {
    return <Unavailable text={`Плагин раздела «${base.label}» выключен в этом пространстве. Данные сохранены — включите его в Настройках.`} />;
  }
  const Section = base.component;
  return <Section params={{ instanceId: ref.instance, view: ref.view, locked: true }} api={api} />;
}

function Unavailable({ text }: { text: string }): React.ReactElement {
  return (
    <PanelShell>
      <PanelBody>
        <EmptyState icon={PanelTop} title="Вкладка недоступна" description={text} />
      </PanelBody>
    </PanelShell>
  );
}
