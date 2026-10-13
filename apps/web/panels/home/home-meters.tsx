"use client";

import { useAddMeterReading, useCreateMeter, useDeleteMeter, useDeleteMeterReading } from "@orion/core-react";
import { METER_KIND_LABEL, METER_KINDS, type Meter, type MeterKind } from "@orion/shared-types";
import { Button, ConfirmDialog, Input, Select, useToast } from "@orion/ui";
import { Gauge, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { shortDate } from "../../lib/format";
import { EmptyLine, SectionCard, type HomeSectionProps } from "./shared";

function num(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

/** Utility meters: type today's reading, see what was used since the last one. */
export function HomeMeters({ workspaceId, home, overview }: HomeSectionProps): React.ReactElement {
  const { toast } = useToast();
  const createMeter = useCreateMeter(workspaceId);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<MeterKind>("electricity");

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await createMeter.mutateAsync({ homeId: home.id, input: { name: name.trim(), kind } });
      setName("");
    } catch (error) {
      toast({ title: "Не удалось добавить счётчик", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <SectionCard title="Счётчики" icon={Gauge}>
      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Счётчик, например «свет»" aria-label="Название счётчика" />
        </div>
        <Select aria-label="Вид счётчика" value={kind} onChange={(event) => setKind(event.target.value as MeterKind)} className="w-auto">
          {METER_KINDS.map((k) => (
            <option key={k} value={k}>
              {METER_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="sm" disabled={createMeter.isPending || !name.trim()}>
          Добавить
        </Button>
      </form>
      {overview.meters.length === 0 ? <EmptyLine>Счётчиков пока нет.</EmptyLine> : overview.meters.map((meter) => <MeterCard key={meter.id} workspaceId={workspaceId} homeId={home.id} meter={meter} />)}
    </SectionCard>
  );
}

function MeterCard({ workspaceId, homeId, meter }: { workspaceId: string | undefined; homeId: string; meter: Meter }): React.ReactElement {
  const { toast } = useToast();
  const addReading = useAddMeterReading(workspaceId);
  const deleteReading = useDeleteMeterReading(workspaceId);
  const deleteMeter = useDeleteMeter(workspaceId);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const last = meter.readings[0];

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const parsed = Number(value.trim().replace(",", "."));
    if (!value.trim() || !Number.isFinite(parsed) || parsed < 0) {
      toast({ title: "Введите показание числом", tone: "danger" });
      return;
    }
    try {
      await addReading.mutateAsync({ homeId, meterId: meter.id, input: { value: parsed, note: "" } });
      setValue("");
    } catch (error) {
      toast({ title: "Показание не записано", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-label font-medium">{meter.name}</span>
        <span className="text-2xs text-subtle-foreground">{METER_KIND_LABEL[meter.kind]}</span>
        <span className="ml-auto font-mono text-label tabular-nums">
          {meter.lastValue === null ? "нет показаний" : `${num(meter.lastValue)} ${meter.unit}`}
        </span>
      </div>
      {last && last.consumption !== null ? (
        <p className="text-2xs text-muted-foreground">
          С прошлого показания ({shortDate(meter.readings[1]?.readAt ?? last.readAt)}): <b>{num(last.consumption)}</b> {meter.unit}
        </p>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="flex items-center gap-2">
        <div className="w-44 shrink-0">
          <Input value={value} onChange={(event) => setValue(event.target.value)} placeholder={`Показание${meter.unit ? `, ${meter.unit}` : ""}`} inputMode="decimal" aria-label={`Показание: ${meter.name}`} />
        </div>
        <Button type="submit" size="sm" disabled={addReading.isPending || !value.trim()}>
          Записать
        </Button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto text-2xs text-subtle-foreground hover:text-foreground">
          {open ? "Скрыть историю" : `История (${meter.readings.length})`}
        </button>
        <button type="button" aria-label={`Удалить счётчик ${meter.name}`} onClick={() => setConfirm(true)} className="rounded p-0.5 text-subtle-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </form>
      {open ? (
        <ul className="divide-y divide-border/60 text-label">
          {meter.readings.map((reading) => (
            <li key={reading.id} className="group flex items-center gap-3 py-1">
              <span className="font-mono text-2xs tabular-nums text-subtle-foreground">{shortDate(reading.readAt)}</span>
              <span className="font-mono tabular-nums">{num(reading.value)}</span>
              <span className="text-2xs text-muted-foreground">{reading.consumption === null ? "" : `+${num(reading.consumption)}`}</span>
              <button
                type="button"
                aria-label="Удалить показание"
                onClick={() => deleteReading.mutate({ homeId, meterId: meter.id, readingId: reading.id }, { onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" }) })}
                className="ml-auto rounded p-0.5 text-subtle-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title="Удалить счётчик?"
        description={`«${meter.name}» вместе со всеми показаниями — действие необратимо.`}
        onConfirm={() => {
          setConfirm(false);
          deleteMeter.mutate({ homeId, meterId: meter.id }, { onError: (error) => toast({ title: "Не удалось удалить", description: describeError(error), tone: "danger" }) });
        }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
