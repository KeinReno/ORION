"use client";

import { useTasks } from "@orion/core-react";
import { Calendar, type CalendarItem } from "@orion/ui";
import { useRouter } from "next/navigation";
import { useActiveWorkspace } from "../../../lib/use-active-workspace";

export default function CalendarPage(): React.ReactElement {
  const router = useRouter();
  const { workspace } = useActiveWorkspace();
  const { data: tasks } = useTasks(workspace?.id);

  const items: CalendarItem[] = (tasks ?? [])
    .filter((task) => task.dueAt)
    .map((task) => ({
      id: task.id,
      date: task.dueAt as string,
      label: task.title,
      overdue: task.status !== "done" && new Date(task.dueAt as string).getTime() < Date.now()
    }));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Календарь</h1>
      <Calendar items={items} onItemClick={(id) => router.push(`/tasks?focus=${id}`)} />
    </div>
  );
}
