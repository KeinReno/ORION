import { Injectable } from "@nestjs/common";
import type { ActivityEntry } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { ModulesService } from "../modules/modules.service";
import { WorkspacesService } from "../workspaces/workspaces.service";

const STATUS_RU: Record<string, string> = {
  backlog: "Бэклог",
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Готово",
  canceled: "Отменено"
};

function statusRu(value: string | null): string {
  return value ? (STATUS_RU[value] ?? value) : "—";
}

function dateRu(value: string | null): string {
  if (!value) return "нет";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

const AGENT_ACTION_RU: Record<string, string> = {
  "tasks.list": "прочитал задачи",
  "tasks.create": "создал задачу",
  "tasks.update": "изменил задачу",
  "notes.list": "прочитал заметки",
  "notes.get": "прочитал заметку",
  "notes.create": "создал заметку",
  "notes.update": "изменил заметку",
  "projects.list": "прочитал проекты",
  "agents.list": "посмотрел список агентов",
  "messages.send": "отправил сообщение агенту",
  "messages.inbox": "прочитал входящие",
  "messages.read": "отметил сообщение прочитанным",
  "jobs.list": "посмотрел задания",
  "jobs.create": "выдал задание другому агенту",
  "jobs.update": "обновил задание",
  "proposals.create": "попросил подтвердить удаление"
};

/**
 * A merged, newest-first feed of the workspace's journals. Each source is read only if
 * the viewer may see its module (`accessibleSetTx`) — the feed must not become a side
 * door around a restricted module.
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly modules: ModulesService
  ) {}

  async feed(userId: string, workspaceId: string, limit = 40): Promise<ActivityEntry[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const accessible = await this.modules.accessibleSetTx(tx, userId, workspaceId);
      const entries: ActivityEntry[] = [];

      if (accessible.has("tasks")) {
        const [changes, comments] = await Promise.all([
          tx.taskActivity.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: { task: { select: { id: true, title: true } }, actor: { select: { name: true } } }
          }),
          tx.taskComment.findMany({
            where: { workspaceId },
            orderBy: { createdAt: "desc" },
            take: limit,
            include: { task: { select: { id: true, title: true } }, author: { select: { name: true } } }
          })
        ]);
        for (const row of changes) {
          const summary =
            row.field === "status"
              ? `Статус: ${statusRu(row.fromValue)} → ${statusRu(row.toValue)}`
              : row.field === "dueAt"
                ? `Срок: ${dateRu(row.fromValue)} → ${dateRu(row.toValue)}`
                : row.field === "assigneeId"
                  ? "Исполнитель изменён"
                  : `Изменено: ${row.field}`;
          entries.push({
            id: `task_change:${row.id}`,
            kind: "task_change",
            at: row.createdAt.toISOString(),
            actorKind: row.actor ? "user" : "unknown",
            actorName: row.actor?.name ?? "—",
            summary,
            entity: { type: "task", id: row.task.id, title: row.task.title }
          });
        }
        for (const row of comments) {
          entries.push({
            id: `task_comment:${row.id}`,
            kind: "task_comment",
            at: row.createdAt.toISOString(),
            actorKind: "user",
            actorName: row.author.name,
            summary: "Комментарий к задаче",
            entity: { type: "task", id: row.task.id, title: row.task.title }
          });
        }
      }

      const agentCalls = await tx.agentAuditEntry.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: limit });
      for (const row of agentCalls) {
        const verb = AGENT_ACTION_RU[row.action] ?? row.action;
        entries.push({
          id: `agent_call:${row.id}`,
          kind: "agent_call",
          at: row.createdAt.toISOString(),
          actorKind: "agent",
          actorName: row.tokenName,
          summary: row.status >= 400 ? `Попытка: ${verb} (отказ ${row.status})` : verb[0].toUpperCase() + verb.slice(1),
          entity: null
        });
      }

      return entries.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    });
  }
}
