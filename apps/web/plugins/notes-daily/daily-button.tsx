"use client";

import { useOpenDailyNote } from "@orion/core-react";
import { Button, useToast } from "@orion/ui";
import { CalendarDays } from "lucide-react";
import type { NotesHeaderActionSlotProps } from "../../lib/extensions/contracts";
import { formatDayTitle } from "../../lib/format";

/** Plugin `notes-daily`: «Сегодня» — opens (or creates) today's daily note. */
export function DailyNoteButton({ workspaceId, onOpenNote }: NotesHeaderActionSlotProps): React.ReactElement {
  const openDaily = useOpenDailyNote(workspaceId);
  const { toast } = useToast();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={openDaily.isPending}
      onClick={() =>
        openDaily.mutate(undefined, {
          onSuccess: (note) => {
            onOpenNote(note.id);
            toast({ title: `Ежедневная: ${note.dailyOn ? formatDayTitle(note.dailyOn) : "сегодня"}`, tone: "success" });
          }
        })
      }
    >
      <CalendarDays className="h-4 w-4" /> Сегодня
    </Button>
  );
}
