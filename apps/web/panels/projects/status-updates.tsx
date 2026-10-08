"use client";

import { useCreateProjectUpdate, useDeleteProjectUpdate, useProjectUpdates } from "@orion/core-react";
import {
  PROJECT_HEALTH,
  PROJECT_HEALTH_LABEL,
  type ProjectHealth,
  type ProjectUpdate
} from "@orion/shared-types";
import {
  Badge,
  Button,
  IconButton,
  Input,
  Modal,
  PanelSection,
  SegmentedControl,
  Skeleton,
  Textarea,
  useToast
} from "@orion/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { relativeTime } from "../../lib/format";
import { HEALTH_TONE } from "./project-bits";

interface UpdateValues {
  health: ProjectHealth;
  summary: string;
  blocker: string;
  nextStep: string;
}

/**
 * «Состояние» — the author's own words about where the project stands, kept as
 * a history of dated reports. It is *not* derived from progress or deadlines:
 * those indicators stay on the overview as computed facts, and this block is a
 * human statement with a name and a date, so the two never read as one number.
 */
export function ProjectStatusSection({
  workspaceId,
  projectId
}: {
  workspaceId: string | undefined;
  projectId: string;
}): React.ReactElement {
  const { toast } = useToast();
  const { data: updates, isLoading, isError, error } = useProjectUpdates(workspaceId, projectId);
  const create = useCreateProjectUpdate(workspaceId, projectId);
  const remove = useDeleteProjectUpdate(workspaceId, projectId);
  const [writing, setWriting] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const latest = updates?.[0];
  const older = updates?.slice(1) ?? [];

  function submit(values: UpdateValues): void {
    create.mutate(values, {
      onSuccess: () => {
        setWriting(false);
        toast({ title: "Состояние обновлено", tone: "success" });
      },
      onError: (err) => toast({ title: "Не удалось сохранить", description: describeError(err), tone: "danger" })
    });
  }

  function confirmDelete(update: ProjectUpdate): void {
    remove.mutate(update.id, {
      onSuccess: () => setConfirmId(null),
      onError: (err) => toast({ title: "Не удалось удалить", description: describeError(err), tone: "danger" })
    });
  }

  return (
    <PanelSection
      title="Состояние"
      actions={
        <Button size="sm" variant="outline" onClick={() => setWriting(true)} disabled={!workspaceId}>
          <Plus className="h-4 w-4" /> Обновить
        </Button>
      }
    >
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : isError ? (
        <p className="text-label text-destructive">Не удалось загрузить: {describeError(error)}</p>
      ) : !latest ? (
        <p className="text-label text-muted-foreground">
          Отчётов пока нет. Короткое «по плану / есть риск / задержка» с одним следующим шагом помогает другим не гадать.
        </p>
      ) : (
        <div className="space-y-3">
          <UpdateCard
            update={latest}
            confirming={confirmId === latest.id}
            busy={remove.isPending}
            onAskDelete={() => setConfirmId(latest.id)}
            onCancelDelete={() => setConfirmId(null)}
            onConfirmDelete={() => confirmDelete(latest)}
          />
          {older.length > 0 ? (
            <div className="space-y-2">
              <Button size="sm" variant="ghost" onClick={() => setShowHistory((value) => !value)} aria-expanded={showHistory}>
                {showHistory ? "Скрыть историю" : `История · ${older.length}`}
              </Button>
              {showHistory ? (
                <ul className="space-y-2">
                  {older.map((update) => (
                    <li key={update.id}>
                      <UpdateCard
                        update={update}
                        compact
                        confirming={confirmId === update.id}
                        busy={remove.isPending}
                        onAskDelete={() => setConfirmId(update.id)}
                        onCancelDelete={() => setConfirmId(null)}
                        onConfirmDelete={() => confirmDelete(update)}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <Modal open={writing} onClose={() => setWriting(false)} title="Обновить состояние проекта" size="md">
        <UpdateForm busy={create.isPending} onSubmit={submit} onCancel={() => setWriting(false)} />
      </Modal>
    </PanelSection>
  );
}

function UpdateCard({
  update,
  compact = false,
  confirming,
  busy,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete
}: {
  update: ProjectUpdate;
  compact?: boolean;
  confirming: boolean;
  busy: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}): React.ReactElement {
  return (
    <article className="rounded-xl border border-border bg-card px-4 py-3">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={HEALTH_TONE[update.health]}>{PROJECT_HEALTH_LABEL[update.health]}</Badge>
        <span className="text-micro text-subtle-foreground">
          {update.authorName} · {relativeTime(update.createdAt)}
        </span>
        {update.mine ? (
          <span className="ml-auto flex items-center gap-1">
            {confirming ? (
              <>
                <Button size="sm" variant="subtle" onClick={onCancelDelete}>
                  Отмена
                </Button>
                <Button size="sm" variant="danger" onClick={onConfirmDelete} disabled={busy}>
                  Удалить
                </Button>
              </>
            ) : (
              <IconButton label="Удалить отчёт" size="sm" tone="danger" onClick={onAskDelete}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            )}
          </span>
        ) : null}
      </header>
      <p className={compact ? "mt-1.5 text-label text-foreground" : "mt-2 text-body text-foreground"}>{update.summary}</p>
      {update.blocker ? (
        <p className="mt-2 text-label text-muted-foreground">
          <span className="font-medium text-foreground">Препятствие: </span>
          {update.blocker}
        </p>
      ) : null}
      {update.nextStep ? (
        <p className="mt-1 text-label text-muted-foreground">
          <span className="font-medium text-foreground">Следующий шаг: </span>
          {update.nextStep}
        </p>
      ) : null}
    </article>
  );
}

function UpdateForm({
  busy,
  onSubmit,
  onCancel
}: {
  busy: boolean;
  onSubmit: (values: UpdateValues) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [health, setHealth] = useState<ProjectHealth>("on_track");
  const [summary, setSummary] = useState("");
  const [blocker, setBlocker] = useState("");
  const [nextStep, setNextStep] = useState("");

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!summary.trim()) return;
    onSubmit({ health, summary: summary.trim(), blocker: blocker.trim(), nextStep: nextStep.trim() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <SegmentedControl<ProjectHealth>
        value={health}
        onChange={setHealth}
        size="sm"
        options={PROJECT_HEALTH.map((value) => ({ value, label: PROJECT_HEALTH_LABEL[value] }))}
      />
      <Textarea
        aria-label="Что изменилось"
        placeholder="Что изменилось с прошлого отчёта"
        rows={4}
        maxLength={2000}
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        autoFocus
        required
      />
      <Input
        aria-label="Препятствие"
        placeholder="Препятствие (если есть)"
        maxLength={1000}
        value={blocker}
        onChange={(event) => setBlocker(event.target.value)}
      />
      <Input
        aria-label="Следующий шаг"
        placeholder="Следующий шаг"
        maxLength={1000}
        value={nextStep}
        onChange={(event) => setNextStep(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="subtle" size="sm" onClick={onCancel}>
          Отмена
        </Button>
        <Button type="submit" size="sm" disabled={busy || !summary.trim()}>
          Сохранить
        </Button>
      </div>
    </form>
  );
}
