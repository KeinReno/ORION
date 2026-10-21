import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { isOrionModuleId, type OrionModuleId } from "@orion/shared-types";
export interface MobileModuleDefinition {
  id: OrionModuleId; label: string; icon: LucideIcon; summary: string;
  render: () => ReactNode;
  primary?: { label: string; run: () => void; disabled: boolean };
}
export function createModuleRegistry(definitions: readonly MobileModuleDefinition[]): readonly MobileModuleDefinition[] {
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!isOrionModuleId(definition.id) || ids.has(definition.id)) throw new Error("Некорректная регистрация мобильного модуля: " + definition.id);
    ids.add(definition.id);
  }
  return definitions;
}
