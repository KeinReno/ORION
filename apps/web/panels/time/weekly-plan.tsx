"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import { formatDuration, isoWeekKey, isoWeekRange, timeAnalyticsSchema, timePlanSchema } from "@orion/shared-types";
import { Button, Input, PanelSection } from "@orion/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { describeError } from "../../lib/error-message";

export function WeeklyTimePlan({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }): React.ReactElement {
  const { api } = useCore();
  const client = createModuleClient(api, workspaceModuleBase(workspaceId, "time"));
  const [week] = useState(() => isoWeekKey());
  const range = isoWeekRange(week);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const analytics = useQuery({
    queryKey: ["time", workspaceId, "week-plan", week],
    queryFn: () => {
      if (!range) throw new Error("Неделя не найдена");
      const params = new URLSearchParams({ from: range.from.toISOString(), to: range.to.toISOString() });
      return client.get(`/analytics?${params}`, timeAnalyticsSchema);
    }
  });
  const plan = analytics.data?.plan.weeks.find((item) => item.week === week);
  const write = useMutation({
    mutationFn: async (plannedMinutes: number) => {
      const plans = await client.get(`/plans?fromWeek=${week}&toWeek=${week}`, timePlanSchema.array());
      const note = plans.find((item) => item.week === week)?.note ?? "";
      return client.put(`/plans/${week}`, { plannedMinutes, note }, timePlanSchema);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["time", workspaceId] });
      setDraft(null);
    }
  });
  const valid = draft !== null && draft.trim() !== "" && Number.isInteger(Number(draft)) && Number(draft) >= 0 && Number(draft) <= 10_080;
  return (
    <PanelSection title="План и факт за неделю">
      {analytics.isPending ? <p>Загрузка…</p> : analytics.isError ? <p role="alert">{describeError(analytics.error)}</p> : (
        <div className="space-y-2 text-label">
          <p>План: {plan?.plannedMinutes == null ? "не задан" : formatDuration(plan.plannedMinutes)}</p>
          <p>Учтено: {formatDuration(analytics.data.totals.minutes)}</p>
          {canManage ? (
            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
              event.preventDefault();
              if (valid && !write.isPending) write.mutate(Number(draft));
            }}>
              <label className="flex flex-col gap-1">
                План в минутах
                <Input type="number" min={0} max={10_080} step={1} value={draft ?? plan?.plannedMinutes ?? ""} onChange={(event) => setDraft(event.target.value)} />
              </label>
              <Button type="submit" size="sm" disabled={!valid || write.isPending}>Сохранить</Button>
            </form>
          ) : null}
          {write.isError ? <p role="alert">{describeError(write.error)}</p> : null}
        </div>
      )}
    </PanelSection>
  );
}
