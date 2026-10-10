"use client";

import { useCreateNote, useNotes } from "@orion/core-react";
import { DropdownMenu, IconButton, useToast } from "@orion/ui";
import { FileStack, FileText } from "lucide-react";
import { FilterChip } from "../../components/filter-chip";
import type { NotesFilterSlotProps, NotesTemplatePickerSlotProps } from "../../lib/extensions/contracts";

/** Plugin `notes-templates`: the «Шаблоны · N» filter chip of the notes list. */
export function TemplatesChip({ workspaceId, active, onToggle }: NotesFilterSlotProps): React.ReactElement {
  const { data: templates } = useNotes(workspaceId, "", "active", true);
  return (
    <FilterChip active={active} onClick={onToggle}>
      Шаблоны{templates && templates.length > 0 ? ` · ${templates.length}` : ""}
    </FilterChip>
  );
}

/** Plugin `notes-templates`: «Из шаблона» — a new note filled from a template. Nothing is drawn without templates. */
export function TemplatePicker({ workspaceId, onOpenNote }: NotesTemplatePickerSlotProps): React.ReactElement | null {
  const { data: templates } = useNotes(workspaceId, "", "active", true);
  const createNote = useCreateNote(workspaceId);
  const { toast } = useToast();
  if (!templates || templates.length === 0) return null;
  return (
    <DropdownMenu
      align="end"
      trigger={({ toggle }) => (
        <IconButton label="Из шаблона" size="sm" onClick={toggle}>
          <FileStack className="h-4 w-4" />
        </IconButton>
      )}
      items={templates.map((template) => ({
        label: template.title || "Без заголовка",
        icon: FileText,
        onSelect: () =>
          void createNote
            .mutateAsync({ title: template.title, summary: template.summary, body: template.body, tags: template.tags })
            .then((created) => {
              onOpenNote(created.id);
              toast({ title: "Заметка из шаблона", tone: "success" });
            })
      }))}
    />
  );
}
