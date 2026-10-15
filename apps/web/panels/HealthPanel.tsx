"use client";

import { useCreateHealthSubject, useHealthSubjects } from "@orion/core-react";
import { healthCanWrite, type HealthSubject } from "@orion/shared-types";
import { Button, EmptyState, Modal, PanelBody, PanelHeader, PanelShell, SegmentedControl, Select, Skeleton, useToast } from "@orion/ui";
import { HeartPulse, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { describeError } from "../lib/error-message";
import { useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import type { PanelComponentProps } from "../lib/panel-registry";
import { HealthAppointments } from "./health/appointments";
import { HealthPreventive } from "./health/preventive";
import { HealthProfile, SubjectForm } from "./health/profile";
import { HealthToday } from "./health/today";

const SELECTED_KEY = "orion.health.subject";
type Tab = "today" | "appointments" | "preventive" | "profile";

/**
 * «Здоровье» (ADR-0012): данные принадлежат ЧЕЛОВЕКУ. Селектор «о ком смотрим» всегда виден; человек,
 * к которому нет доступа, не показывается вовсе. Это журнал и напоминалка, не медицинский совет.
 */
export function HealthPanel(_props: PanelComponentProps): React.ReactElement {
  const { workspace } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { isEnabled } = useEnabledModules();
  const { toast } = useToast();
  const { data: subjects, isLoading, isError, refetch } = useHealthSubjects(workspaceId);
  const create = useCreateHealthSubject(workspaceId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [creating, setCreating] = useState<"member" | "dependent" | null>(null);

  useEffect(() => {
    try {
      setSelectedId(localStorage.getItem(`${SELECTED_KEY}:${workspaceId}`));
    } catch {
      /* a remembered person is a convenience only */
    }
  }, [workspaceId]);

  const list = subjects ?? [];
  const subject: HealthSubject | null = list.find((s) => s.id === selectedId) ?? list[0] ?? null;
  const hasOwnProfile = list.some((s) => s.kind === "member" && s.access === "own");

  function select(id: string, nextTab?: Tab): void {
    setSelectedId(id);
    if (nextTab) setTab(nextTab);
    try {
      localStorage.setItem(`${SELECTED_KEY}:${workspaceId}`, id);
    } catch {
      /* ignore */
    }
  }

  async function submitNew(values: Parameters<typeof create.mutateAsync>[0]): Promise<void> {
    try {
      const created = await create.mutateAsync(values);
      select(created.id, "today");
      setCreating(null);
    } catch (error) {
      toast({ title: "Не удалось сохранить", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader
        icon={HeartPulse}
        title="Здоровье"
        subtitle={subject ? subject.name : "Личный журнал"}
        actions={
          <Button size="sm" onClick={() => setCreating(hasOwnProfile ? "dependent" : "member")}>
            <Plus className="h-4 w-4" /> {hasOwnProfile ? "Добавить человека" : "Мой профиль"}
          </Button>
        }
      />
      <PanelBody className="space-y-4 [container-type:inline-size]">
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : isError ? (
          <EmptyState icon={HeartPulse} title="Не удалось загрузить" description="Проверьте соединение и попробуйте ещё раз." action={<Button size="sm" onClick={() => void refetch()}>Повторить</Button>} />
        ) : !subject ? (
          <EmptyState
            icon={HeartPulse}
            title="Начните с профиля"
            description="Здоровье ведётся по людям: ваш профиль виден только вам, а ребёнка или родителя вы ведёте как опекун. Другим участникам доступ — только если вы сами его откроете."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setCreating("member")}>Это я</Button>
                <Button size="sm" variant="outline" onClick={() => setCreating("dependent")}>Ребёнок или родственник</Button>
              </div>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Select aria-label="О ком смотрим" className="max-w-[16rem]" value={subject.id} onChange={(event) => select(event.target.value)}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.kind === "dependent" ? " (веду я)" : s.access !== "own" ? " (доступ дан мне)" : ""}
                  </option>
                ))}
              </Select>
              {!healthCanWrite(subject.access) ? <span className="rounded-md bg-white/5 px-2 py-0.5 text-2xs text-muted-foreground">Только просмотр</span> : null}
              <SegmentedControl
                size="sm"
                aria-label="Раздел"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "today", label: "Сегодня" },
                  { value: "appointments", label: "Визиты" },
                  { value: "preventive", label: "Профилактика" },
                  { value: "profile", label: "Карточка" }
                ]}
              />
            </div>
            <div role="tabpanel">
              {tab === "today" ? <HealthToday workspaceId={workspaceId} subjects={list} onOpen={(id, next) => select(id, next)} /> : null}
              {tab === "appointments" ? <HealthAppointments workspaceId={workspaceId} subject={subject} contactsEnabled={isEnabled("contacts")} /> : null}
              {tab === "preventive" ? <HealthPreventive workspaceId={workspaceId} subject={subject} /> : null}
              {tab === "profile" ? <HealthProfile workspaceId={workspaceId} subject={subject} onDeleted={() => setSelectedId(null)} /> : null}
            </div>
            <p className="text-2xs text-subtle-foreground">Это ваш журнал, он не заменяет консультацию врача. Данные видны только выбранному человеку и тем, кому он дал доступ.</p>
          </>
        )}
      </PanelBody>

      <Modal open={creating !== null} onClose={() => setCreating(null)} title={creating === "member" ? "Мой профиль" : "Новый человек"} size="sm">
        {creating ? <SubjectForm key={creating} kind={creating} busy={create.isPending} onSubmit={submitNew} onCancel={() => setCreating(null)} /> : null}
      </Modal>
    </PanelShell>
  );
}
