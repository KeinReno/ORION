"use client";

import { useNotes, useSession } from "@orion/core-react";
import { TiltCard } from "@orion/ui";
import { useActiveWorkspace } from "../../../lib/use-active-workspace";

export default function DashboardPage(): React.ReactElement {
  const { user } = useSession();
  const { workspace } = useActiveWorkspace();
  const { data: notes } = useNotes(workspace?.id);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Привет, {user?.name}</h1>

      <TiltCard className="max-w-md">
        <p className="text-xs uppercase tracking-wide text-white/40">Рабочее пространство</p>
        <p className="mt-1 text-lg font-medium">{workspace?.name ?? "…"}</p>
        <p className="mt-4 text-sm text-white/60">
          Заметок: <span className="text-white">{notes?.length ?? 0}</span>
        </p>
      </TiltCard>
    </div>
  );
}
