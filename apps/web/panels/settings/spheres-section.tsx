"use client";

import {
  useAssignWorkspaceSphere,
  useCreateSphere,
  useDeleteSphere,
  useSetWorkspaceFavorite,
  useUpdateSphere,
  useWorkspaceOrganization
} from "@orion/core-react";
import { Button, Card, Input, Select, useToast } from "@orion/ui";
import { Star, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeAuthError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";

/**
 * U05 (24-CONNECTED-CORE-BACKLOG.md) — "Личные сферы, presets, переключатель
 * и избранное". A sphere groups the CALLING USER's own workspaces for
 * navigation only (23-UNIVERSAL-CONNECTED-CORE.md, "Иерархия и владение");
 * it never changes who can see or edit anything, so this form only ever
 * touches `spheres`/`favoriteWorkspaceIds` on the user's own preferences —
 * unlike `workspace-section.tsx` next to it, there is no owner-only gate
 * here, because nothing here is workspace-owned data.
 */
export function SpheresSettings(): React.ReactElement {
  const { workspaces } = useActiveWorkspace();
  const { data: organization, isLoading } = useWorkspaceOrganization();
  const createSphere = useCreateSphere();
  const updateSphere = useUpdateSphere();
  const deleteSphere = useDeleteSphere();
  const assignSphere = useAssignWorkspaceSphere();
  const setFavorite = useSetWorkspaceFavorite();
  const { toast } = useToast();

  const [newSphereName, setNewSphereName] = useState("");

  async function onCreate(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newSphereName.trim();
    if (!name) return;
    try {
      await createSphere.mutateAsync({ name });
      setNewSphereName("");
    } catch (error) {
      toast({ title: "Не удалось создать сферу", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onRename(sphereId: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await updateSphere.mutateAsync({ sphereId, input: { name: trimmed } });
    } catch (error) {
      toast({ title: "Не удалось переименовать сферу", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onDelete(sphereId: string): Promise<void> {
    try {
      await deleteSphere.mutateAsync(sphereId);
      toast({ title: "Сфера удалена", tone: "default" });
    } catch (error) {
      toast({ title: "Не удалось удалить сферу", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onAssign(workspaceId: string, sphereId: string | null): Promise<void> {
    try {
      await assignSphere.mutateAsync({ workspaceId, sphereId });
    } catch (error) {
      toast({ title: "Не удалось перенести пространство", description: describeAuthError(error), tone: "danger" });
    }
  }

  async function onToggleFavorite(workspaceId: string, favorite: boolean): Promise<void> {
    try {
      await setFavorite.mutateAsync({ workspaceId, favorite });
    } catch (error) {
      toast({ title: "Не удалось изменить избранное", description: describeAuthError(error), tone: "danger" });
    }
  }

  if (isLoading || !organization) return <Card className="text-sm text-muted-foreground">Загрузка…</Card>;

  const spheres = [...organization.spheres].sort((a, b) => a.order - b.order);
  const favoriteIds = new Set(organization.favoriteWorkspaceIds);
  const sphereOfWorkspace = new Map<string, string>();
  for (const sphere of spheres) {
    for (const workspaceId of sphere.workspaceIds) sphereOfWorkspace.set(workspaceId, sphere.id);
  }

  return (
    <div className="space-y-6">
      <Card data-setting="spheres" className="space-y-4">
        <div>
          <p className="text-sm font-medium text-foreground">Сферы</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Личная группировка ваших пространств («Дом», «Работа») — только для навигации. Название, порядок и состав
            видны только вам и не дают доступ другим участникам. Одно пространство может входить не более чем в одну
            вашу сферу; у каждого участника общего пространства может быть своя раскладка по сферам.
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-3" onSubmit={onCreate}>
          <label className="min-w-[200px] flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Новая сфера</span>
            <Input
              maxLength={60}
              placeholder="Например, «Дом»"
              value={newSphereName}
              onChange={(e) => setNewSphereName(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={!newSphereName.trim() || createSphere.isPending}>
            Добавить
          </Button>
        </form>

        {spheres.length === 0 ? (
          <p className="text-xs text-subtle-foreground">
            Сфер пока нет — все пространства показываются одним общим списком. Это нормальное состояние, создавать
            сферу не обязательно.
          </p>
        ) : (
          <ul className="space-y-2">
            {spheres.map((sphere) => (
              <li key={sphere.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
                <Input
                  className="min-w-[140px] flex-1"
                  maxLength={60}
                  defaultValue={sphere.name}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== sphere.name) void onRename(sphere.id, e.target.value);
                  }}
                />
                <span className="text-2xs text-subtle-foreground">{sphere.workspaceIds.length} пространств</span>
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive/50 text-destructive hover:bg-destructive/10"
                  onClick={() => void onDelete(sphere.id)}
                  aria-label={`Удалить сферу «${sphere.name}»`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card data-setting="favorites" className="space-y-3">
        <div>
          <p className="text-sm font-medium text-foreground">Пространства</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Назначьте сферу и избранное для каждого пространства, где вы состоите. Это не меняет ни доступ, ни данные
            — только то, как переключатель их группирует и закрепляет для вас.
          </p>
        </div>
        <ul className="space-y-2">
          {workspaces.map((workspace) => (
            <li key={workspace.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
              <span className="min-w-[140px] flex-1 truncate text-sm text-foreground">{workspace.name}</span>
              <Select
                value={sphereOfWorkspace.get(workspace.id) ?? ""}
                onChange={(e) => void onAssign(workspace.id, e.target.value || null)}
                className="min-w-[160px]"
              >
                <option value="">Без сферы</option>
                {spheres.map((sphere) => (
                  <option key={sphere.id} value={sphere.id}>
                    {sphere.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                className={favoriteIds.has(workspace.id) ? "text-amber-400" : "text-muted-foreground"}
                aria-pressed={favoriteIds.has(workspace.id)}
                aria-label={favoriteIds.has(workspace.id) ? "Убрать из избранного" : "Добавить в избранное"}
                onClick={() => void onToggleFavorite(workspace.id, !favoriteIds.has(workspace.id))}
              >
                <Star className="h-3.5 w-3.5" fill={favoriteIds.has(workspace.id) ? "currentColor" : "none"} />
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
