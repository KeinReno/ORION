import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import type { Prisma } from "@prisma/client";
import type { CalendarConnection, CalendarConnectionInput } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { openSecret, sealSecret, syncSecretAvailable } from "../sync/sync-crypto";
import { WorkspacesService } from "../workspaces/workspaces.service";
import { assertPublicRemoteUrl, fetchPublicText, MAX_REMOTE_RESPONSE_BYTES } from "../common/remote-url-guard";

/** Everything a sync pass needs, without caring whether it runs for a user or for the system. */
type SyncableConnection = {
  id: string;
  workspaceId: string;
  url: string;
  kind: string;
  username: string;
  passwordEnc: string;
  color: string | null;
};

@Injectable()
export class CalendarConnectionsService {
  private readonly logger = new Logger(CalendarConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<CalendarConnection[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.calendarConnection.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: CalendarConnectionInput): Promise<CalendarConnection> {
    await validateRemoteUrl(input.url);
    if (input.password && !syncSecretAvailable()) throw new BadRequestException("Для хранения пароля задайте SYNC_SECRET");
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.calendarConnection.create({
        data: {
          workspaceId,
          name: input.name,
          kind: input.kind,
          url: input.url,
          username: input.username,
          passwordEnc: input.password ? sealSecret(input.password) : "",
          color: input.color ?? null,
          enabled: input.enabled
        }
      });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, id: string, input: CalendarConnectionInput): Promise<CalendarConnection> {
    await validateRemoteUrl(input.url);
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const current = await this.assertOwnedTx(tx, workspaceId, id);
      if (input.password && !syncSecretAvailable()) throw new BadRequestException("Для хранения пароля задайте SYNC_SECRET");
      return tx.calendarConnection.update({
        where: { id },
        data: {
          name: input.name,
          kind: input.kind,
          url: input.url,
          username: input.username,
          passwordEnc: input.password ? sealSecret(input.password) : current.passwordEnc,
          color: input.color ?? null,
          enabled: input.enabled
        }
      });
    });
    return toDto(row);
  }

  async sync(userId: string, workspaceId: string, id: string): Promise<{ imported: number }> {
    const connection = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return this.assertOwnedTx(tx, workspaceId, id);
    });
    return this.performSync((fn) => this.prisma.withUser(userId, fn), connection);
  }

  /**
   * Keeps enabled subscriptions fresh on its own. Without this the feed was
   * only ever read when someone pressed "Синхронизировать" — a subscription
   * that nobody opens slowly goes stale, and the new `Event.externalUid`
   * upserts (and removals) never ran.
   *
   * A failure on one connection is logged and recorded on that row
   * (`lastError`, which the panel shows) and never stops the others — one
   * broken feed must not block every calendar in the database.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async handleCron(): Promise<void> {
    const connections = await this.prisma.asSystem((tx) =>
      tx.calendarConnection.findMany({
        where: { enabled: true, workspace: { NOT: { disabledModules: { has: "calendar" } } } },
        select: {
          id: true,
          workspaceId: true,
          url: true,
          kind: true,
          username: true,
          passwordEnc: true,
          color: true
        }
      })
    );

    let synced = 0;
    for (const connection of connections) {
      try {
        await this.performSync((fn) => this.prisma.asSystem(fn), connection);
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Scheduled sync failed for calendar connection ${connection.id}: ${message}`);
      }
    }
    if (synced > 0) this.logger.log(`Synced ${synced} external calendar(s)`);
  }

  /**
   * The actual pull, shared by the manual endpoint (user-scoped) and the cron
   * (system-scoped) — `scope` is the only difference between the two.
   */
  private async performSync(
    scope: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>,
    connection: SyncableConnection
  ): Promise<{ imported: number }> {
    const id = connection.id;
    await validateRemoteUrl(connection.url);
    const headers: Record<string, string> = { Accept: "text/calendar, text/plain;q=0.8" };
    if (connection.username) {
      const password = connection.passwordEnc ? openSecret(connection.passwordEnc) : "";
      headers.Authorization = `Basic ${Buffer.from(`${connection.username}:${password}`).toString("base64")}`;
    }

    try {
      // fetchPublicText: no redirect following (a 3xx is a rejection — the
      // pre-check only vetted the original hostname), a streamed 5 MiB cap,
      // and DNS pinned at connect time so a rebinding resolver can't swap in
      // an internal address after validateRemoteUrl() passed.
      const text = await fetchPublicText(connection.url, {
        headers,
        timeoutMs: 20_000,
        maxBytes: MAX_REMOTE_RESPONSE_BYTES,
        label: "Календарь"
      });
      const parsed = parseICalendar(text);
      await scope(async (tx) => {
        const seen: string[] = [];
        for (const item of parsed) {
          seen.push(item.uid);
          await tx.event.upsert({
            where: { calendarConnectionId_externalUid: { calendarConnectionId: id, externalUid: item.uid } },
            create: {
              workspaceId: connection.workspaceId,
              calendarConnectionId: id,
              externalUid: item.uid,
              source: connection.kind,
              readOnly: true,
              title: item.title,
              description: item.description,
              location: item.location,
              startAt: item.startAt,
              endAt: item.endAt,
              allDay: item.allDay,
              colorTag: connection.color
            },
            update: {
              title: item.title,
              description: item.description,
              location: item.location,
              startAt: item.startAt,
              endAt: item.endAt,
              allDay: item.allDay,
              colorTag: connection.color
            }
          });
        }
        await tx.event.deleteMany({ where: { calendarConnectionId: id, externalUid: { notIn: seen } } });
        await tx.calendarConnection.update({ where: { id }, data: { lastSyncAt: new Date(), lastError: null } });
      });
      return { imported: parsed.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await scope((tx) => tx.calendarConnection.update({ where: { id }, data: { lastError: message } }));
      throw new BadRequestException(`Не удалось синхронизировать календарь: ${message}`);
    }
  }

  async remove(userId: string, workspaceId: string, id: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertOwnedTx(tx, workspaceId, id);
      await tx.calendarConnection.delete({ where: { id } });
    });
  }

  private async assertOwnedTx(tx: Prisma.TransactionClient, workspaceId: string, id: string) {
    const row = await tx.calendarConnection.findUnique({ where: { id } });
    if (!row || row.workspaceId !== workspaceId) throw new NotFoundException("Подключение календаря не найдено");
    return row;
  }
}

async function validateRemoteUrl(raw: string): Promise<void> {
  await assertPublicRemoteUrl(raw, "Адрес календаря");
}

interface ParsedEvent { uid: string; title: string; description: string; location: string | null; startAt: Date; endAt: Date; allDay: boolean }

function parseICalendar(source: string): ParsedEvent[] {
  const unfolded = source.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  return blocks.flatMap((block, index) => {
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      fields.set(line.slice(0, colon).split(";")[0].toUpperCase(), line.slice(colon + 1));
    }
    const startRaw = fields.get("DTSTART");
    if (!startRaw) return [];
    const start = parseICalDate(startRaw);
    const endRaw = fields.get("DTEND");
    const allDay = /^\d{8}$/.test(startRaw);
    const end = endRaw ? parseICalDate(endRaw) : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
    return [{
      uid: fields.get("UID") || `generated-${index}-${start.toISOString()}`,
      title: unescapeICal(fields.get("SUMMARY") || "Без названия"),
      description: unescapeICal(fields.get("DESCRIPTION") || ""),
      location: fields.has("LOCATION") ? unescapeICal(fields.get("LOCATION") as string) : null,
      startAt: start,
      endAt: end,
      allDay
    }];
  });
}

function parseICalDate(raw: string): Date {
  if (/^\d{8}$/.test(raw)) return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00.000Z`);
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) throw new Error(`Некорректная дата iCalendar: ${raw}`);
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${match[7] ? "Z" : ""}`);
}

function unescapeICal(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function toDto(row: { id: string; workspaceId: string; name: string; kind: string; url: string; username: string; color: string | null; enabled: boolean; lastSyncAt: Date | null; lastError: string | null; createdAt: Date; updatedAt: Date }): CalendarConnection {
  return { ...row, kind: row.kind as CalendarConnection["kind"], lastSyncAt: row.lastSyncAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
