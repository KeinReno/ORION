"use client";

import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications
} from "@orion/core-react";
import type { Notification } from "@orion/shared-types";
import { Button, EmptyState, IconButton, Popover, Skeleton, cx, useToast } from "@orion/ui";
import { Bell, BellRing, Boxes, CalendarClock, FolderKanban, Info, ListTodo, MessageSquare, Trash2, Wallet } from "lucide-react";
import { useMemo } from "react";
import { relativeTime } from "../lib/format";
import { openEntity, openPanel } from "../lib/panel-bus";
import { notificationTarget } from "../lib/notification-navigation";
import { useActiveWorkspace } from "../lib/use-active-workspace";

const KIND_ICON: Record<Notification["kind"], React.ComponentType<{ className?: string }>> = {
  task_due: ListTodo,
  event_reminder: CalendarClock,
  finance_alert: Wallet,
  inventory_low_stock: Boxes,
  task_comment: MessageSquare,
  project_update: FolderKanban,
  entity_reminder: BellRing,
  system: Info
};

const KIND_LABEL: Record<Notification["kind"], string> = {
  task_due: "Задача",
  event_reminder: "Событие",
  finance_alert: "Финансы",
  inventory_low_stock: "Склад",
  task_comment: "Комментарий",
  project_update: "Проект",
  entity_reminder: "Напоминание",
  system: "Система"
};

/** The popover is a glance, not an inbox — anything older stays on the API for later. */
const VISIBLE_LIMIT = 10;

function openNotificationTarget(item: Notification): void {
  const target = notificationTarget(item);
  if (target?.kind === "entity") openEntity(target.type, target.id);
  else if (target?.kind === "panel") openPanel(target.panelId);
}

/**
 * Header bell with an unread count pip and the notification list behind it.
 * `size="sm"` matches the dockview tab-strip actions; `md` is the compact
 * mobile header. Renders nothing until the active workspace is known.
 */
export function NotificationBell({ size = "md" }: { size?: "sm" | "md" }): React.ReactElement | null {
  const { workspace } = useActiveWorkspace();
  // One request feeds both the badge and the list — no second `unreadOnly`
  // query, since a badge is not worth doubling the traffic on every poll.
  const notifications = useNotifications(workspace?.id);
  const markRead = useMarkNotificationRead(workspace?.id);
  const markAllRead = useMarkAllNotificationsRead(workspace?.id);
  const removeNotification = useDeleteNotification(workspace?.id);
  const { toast } = useToast();

  // Newest first, whatever order the endpoint hands back.
  const items = useMemo(
    () => [...(notifications.data ?? [])].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [notifications.data]
  );

  if (!workspace?.id) return null;

  const unreadCount = items.filter((item) => !item.readAt).length;
  const visible = items.slice(0, VISIBLE_LIMIT);

  async function markAll(): Promise<void> {
    try {
      const result = await markAllRead.mutateAsync();
      toast({ title: `Отмечено: ${result.updated}`, tone: "success" });
    } catch {
      toast({ title: "Не удалось отметить уведомления", tone: "danger" });
    }
  }

  function openItem(item: Notification, close: () => void): void {
    if (!item.readAt) markRead.mutate({ notificationId: item.id, read: true });
    close();
    openNotificationTarget(item);
  }

  return (
    <Popover
      align="end"
      width={360}
      backdrop
      trigger={({ open, toggle, ref }) => (
        // Popover needs a ref on a real element; the trigger is a native
        // button (not IconButton) so the count pip can sit in the corner
        // without a second status glyph stacked on the bell.
        <span ref={ref as unknown as React.RefObject<HTMLSpanElement>} className="relative inline-flex">
          <button
            type="button"
            aria-label={unreadCount > 0 ? `Уведомления, непрочитанных: ${unreadCount}` : "Уведомления"}
            aria-haspopup="dialog"
            aria-expanded={open}
            title="Уведомления"
            onClick={toggle}
            className={cx(
              "relative inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors",
              "hover:bg-white/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60",
              size === "sm" ? "h-6 w-6" : "h-8 w-8"
            )}
          >
            <Bell className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
            {unreadCount > 0 ? (
              <span
                aria-hidden
                className={cx(
                  "absolute flex items-center justify-center rounded-full bg-destructive font-semibold text-white ring-2 ring-background",
                  size === "sm"
                    ? "right-0 top-0 h-3 min-w-3 px-0.5 text-[0.5rem] leading-none"
                    : "right-0 top-0 h-3.5 min-w-3.5 px-0.5 text-[0.5625rem] leading-none"
                )}
              >
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            ) : null}
          </button>
        </span>
      )}
    >
      {({ close }) => (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">Уведомления</p>
            <Button
              size="sm"
              variant="subtle"
              disabled={unreadCount === 0 || markAllRead.isPending}
              onClick={markAll}
            >
              Прочитать все
            </Button>
          </div>

          {notifications.isLoading ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : notifications.isError ? (
            <div className="space-y-2 py-4 text-center">
              <p className="text-xs text-muted-foreground">Не удалось загрузить уведомления</p>
              <Button size="sm" variant="outline" onClick={() => void notifications.refetch()}>
                Повторить
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={Bell} title="Уведомлений нет" />
          ) : (
            <ul className="orion-scroll max-h-[22rem] space-y-1 overflow-y-auto pr-1">
              {visible.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onOpen={() => openItem(item, close)}
                  onToggleRead={() => markRead.mutate({ notificationId: item.id, read: !item.readAt })}
                  onDelete={() => removeNotification.mutate(item.id)}
                />
              ))}
            </ul>
          )}

          {items.length > VISIBLE_LIMIT ? (
            <p className="text-center text-2xs text-subtle-foreground">
              Показаны последние {VISIBLE_LIMIT} из {items.length}
            </p>
          ) : null}
        </div>
      )}
    </Popover>
  );
}

function NotificationRow({
  item,
  onOpen,
  onToggleRead,
  onDelete
}: {
  item: Notification;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}): React.ReactElement {
  const Icon = KIND_ICON[item.kind];
  const unread = !item.readAt;
  const canOpen = notificationTarget(item) !== null;

  return (
    <li
      className={
        "rounded-lg border border-transparent px-2 py-1.5 transition-colors" +
        (canOpen ? " hover:bg-white/5" : "") +
        (unread ? " bg-accent/[0.06]" : "")
      }
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={!canOpen}
        title={canOpen ? "Открыть" : undefined}
        className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${unread ? "text-accent-text" : "text-muted-foreground"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-foreground">{item.title}</span>
            {unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-label="Не прочитано" /> : null}
          </span>
          {item.body ? (
            <span className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">{item.body}</span>
          ) : null}
          <span className="mt-0.5 block text-2xs text-subtle-foreground">
            {KIND_LABEL[item.kind]} · {relativeTime(item.createdAt)}
          </span>
        </span>
      </button>

      <div className="mt-1 flex items-center gap-1 pl-6">
        <Button size="sm" variant="subtle" onClick={onToggleRead}>
          {unread ? "Прочитано" : "Непрочитано"}
        </Button>
        <IconButton label="Удалить" tone="danger" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </li>
  );
}
