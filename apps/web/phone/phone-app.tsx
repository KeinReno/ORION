"use client";

import { useSession } from "@orion/core-react";
import { Button, EmptyState, LoadingScreen } from "@orion/ui";
import { Calendar, CheckSquare, ListChecks, StickyNote, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { setActiveWorkspaceId, useActiveWorkspace } from "../lib/use-active-workspace";
import { useEnabledModules } from "../lib/use-enabled-modules";
import { phoneNeedsPairing } from "./phone-device";
import { PhonePair } from "./phone-pair";
import { PhoneCalendar, PhoneLists, PhoneNotes, PhoneTasks, PhoneToday } from "./phone-screens";

/**
 * Онлайн-оболочка телефона. Пишет только когда узел ответил: локальной очереди
 * здесь нет. Гибридная копия списков, заметок и задач включается сама, если
 * пространство уже в гибридном режиме — это существующий протокол, не новый
 * офлайн телефона.
 */
export type PhoneSection = "today" | "tasks" | "calendar" | "notes" | "lists";

const SECTIONS: { id: PhoneSection; label: string; icon: typeof Sun }[] = [
  { id: "today", label: "Сегодня", icon: Sun },
  { id: "tasks", label: "Задачи", icon: CheckSquare },
  { id: "calendar", label: "Календарь", icon: Calendar },
  { id: "notes", label: "Заметки", icon: StickyNote },
  { id: "lists", label: "Списки", icon: ListChecks }
];

export function PhoneApp(): React.ReactElement {
  const session = useSession();
  const router = useRouter();
  const { workspace, workspaces, isLoading: spacesLoading } = useActiveWorkspace();
  const { isEnabled } = useEnabledModules();
  const [section, setSection] = useState<PhoneSection>("today");
  const [deviceReady, setDeviceReady] = useState(() => !phoneNeedsPairing());

  useEffect(() => {
    if (!deviceReady || session.status !== "unauthenticated") return;
    router.replace("/login?next=/phone");
  }, [deviceReady, router, session.status]);

  useEffect(() => {
    if (workspace || workspaces.length !== 1) return;
    setActiveWorkspaceId(workspaces[0]!.id);
  }, [workspace, workspaces]);

  if (!deviceReady) return <PhonePair onPaired={() => setDeviceReady(true)} />;

  if (session.status === "loading" || session.status === "unauthenticated") {
    return <LoadingScreen label="Проверяем вход…" />;
  }
  if (session.status === "unavailable") {
    return (
      <main className="flex min-h-dvh items-center px-4">
        <EmptyState
          tone="danger"
          title="Нет связи с узлом"
          description="Телефон ничего не откладывает на потом: пока ORION не ответит, записи не сохраняются."
          action={<Button onClick={() => session.retry()}>Повторить</Button>}
        />
      </main>
    );
  }
  if (spacesLoading) return <LoadingScreen label="Загрузка пространств…" />;
  if (!workspace) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-3 px-4 py-6">
        <h1 className="text-xl font-semibold">Пространство</h1>
        {workspaces.length === 0 ? (
          <EmptyState title="Пространств нет" description="Создайте пространство в ORION на компьютере, затем откройте телефон снова." />
        ) : (
          <ul className="space-y-2">
            {workspaces.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="min-h-11 w-full rounded-xl border border-border px-4 py-3 text-left"
                  onClick={() => setActiveWorkspaceId(item.id)}
                >
                  {item.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  }

  const wsId = workspace.id;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div>
          <p className="text-xs text-muted-foreground">ORION</p>
          <h1 className="text-lg font-semibold leading-tight">{SECTIONS.find((item) => item.id === section)?.label}</h1>
        </div>
        {workspaces.length > 1 ? (
          <label className="max-w-[50%] text-right text-sm">
            <span className="sr-only">Пространство</span>
            <select
              className="max-w-full rounded-lg border border-border bg-background px-2 py-2"
              value={workspace.id}
              onChange={(event) => setActiveWorkspaceId(event.target.value)}
            >
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="truncate text-sm text-muted-foreground">{workspace.name}</p>
        )}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {section === "today" ? <PhoneToday workspaceId={wsId} isEnabled={isEnabled} onOpen={setSection} /> : null}
        {section === "tasks" ? <PhoneTasks workspaceId={isEnabled("tasks") ? wsId : undefined} /> : null}
        {section === "calendar" ? <PhoneCalendar workspaceId={isEnabled("calendar") ? wsId : undefined} /> : null}
        {section === "notes" ? <PhoneNotes workspaceId={isEnabled("notes") ? wsId : undefined} /> : null}
        {section === "lists" ? <PhoneLists workspaceId={isEnabled("lists") ? wsId : undefined} /> : null}
      </main>
      <nav
        aria-label="Разделы"
        className="sticky bottom-0 grid grid-cols-5 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
      >
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const current = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={current ? "page" : undefined}
              className={current ? "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-foreground" : "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted-foreground"}
              onClick={() => setSection(item.id)}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
