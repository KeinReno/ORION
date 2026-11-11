import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ContactReferences } from "../contacts/public/contact-references";
import { Prisma, type HealthAppointment as AppointmentRow, type HealthPreventiveItem as PreventiveRow, type HealthSubject as SubjectRow } from "@prisma/client";
import {
  healthAllergySchema,
  healthCanWrite,
  healthPreventiveKindSchema,
  preventiveNextDue,
  preventiveStatus,
  type CreateHealthAppointmentInput,
  type CreateHealthPreventiveInput,
  type CreateHealthSubjectInput,
  type HealthAccess,
  type HealthAppointment,
  type HealthGrant,
  type HealthPreventiveItem,
  type HealthSubject,
  type HealthToday,
  type MarkHealthPreventiveDoneInput,
  type PutHealthGrantInput,
  type UpdateHealthAppointmentInput,
  type UpdateHealthPreventiveInput,
  type UpdateHealthSubjectInput
} from "@orion/shared-types";
import { z } from "zod";
import { PrismaService } from "../common/prisma.service";
import { dosesForDayTx } from "./health-doses";
import { WorkspacesService } from "../workspaces/workspaces.service";

type Need = "read" | "write" | "own";
const DAY_MS = 24 * 60 * 60 * 1000;
const dayDate = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const dayString = (date: Date): string => date.toISOString().slice(0, 10);
const TODAY_RE = /^\d{4}-\d{2}-\d{2}$/;

type SubjectWithGrants = SubjectRow & { grants: Array<{ level: string }> };

/**
 * Module «Здоровье» (ADR-0012). Access follows the PERSON: every method first resolves the subject with
 * `assertSubjectTx`, which says 404 for a person the caller cannot see (existence is not revealed) and 403
 * when the caller sees them but lacks the level. RLS repeats the same rule in the database
 * (`health_subject_access`), so a forgotten check still cannot return another person's rows.
 * Workspace owners and leads get NO extra rights here by design.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
    private readonly contacts: ContactReferences
  ) {}

  // --------------------------------------------------------------- subjects

  async listSubjects(userId: string, workspaceId: string, archived = false): Promise<HealthSubject[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const rows = await tx.healthSubject.findMany({
        where: { workspaceId, archivedAt: archived ? { not: null } : null },
        include: { grants: { where: { granteeUserId: userId }, select: { level: true } } },
        orderBy: { createdAt: "asc" }
      });
      return rows.map((row) => subjectDto(row, userId));
    });
  }

  async createSubject(userId: string, workspaceId: string, input: CreateHealthSubjectInput): Promise<HealthSubject> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      try {
        const row = await tx.healthSubject.create({
          data: {
            workspaceId,
            userId: input.kind === "member" ? userId : null,
            guardianUserId: input.kind === "dependent" ? userId : null,
            name: input.name,
            birthDate: input.birthDate ? dayDate(input.birthDate) : null,
            bloodType: input.bloodType,
            allergies: input.allergies,
            conditions: input.conditions,
            emergencyNote: input.emergencyNote
          },
          include: { grants: { where: { granteeUserId: userId }, select: { level: true } } }
        });
        return subjectDto(row, userId);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new ConflictException("Ваш профиль в этом пространстве уже создан");
        }
        throw error;
      }
    });
  }

  async updateSubject(userId: string, workspaceId: string, subjectId: string, input: UpdateHealthSubjectInput): Promise<HealthSubject> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "own");
      const row = await tx.healthSubject.update({
        where: { id: subjectId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.birthDate !== undefined ? { birthDate: input.birthDate ? dayDate(input.birthDate) : null } : {}),
          ...(input.bloodType !== undefined ? { bloodType: input.bloodType } : {}),
          ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
          ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
          ...(input.emergencyNote !== undefined ? { emergencyNote: input.emergencyNote } : {}),
          ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt === null ? null : new Date(input.archivedAt) } : {})
        },
        include: { grants: { where: { granteeUserId: userId }, select: { level: true } } }
      });
      return subjectDto(row, userId);
    });
  }

  /** Everything about the person goes with them (visits, checkups, grants); the UI says so before asking. */
  async removeSubject(userId: string, workspaceId: string, subjectId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "own");
      await tx.healthSubject.delete({ where: { id: subjectId } });
    });
  }

  // ----------------------------------------------------------------- grants

  async listGrants(userId: string, workspaceId: string, subjectId: string): Promise<HealthGrant[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "own");
      const rows = await tx.healthGrant.findMany({
        where: { subjectId },
        include: { grantee: { select: { name: true } } },
        orderBy: { createdAt: "asc" }
      });
      return rows.map((row) => ({
        subjectId: row.subjectId,
        granteeUserId: row.granteeUserId,
        granteeName: row.grantee.name,
        level: row.level === "write" ? ("write" as const) : ("read" as const),
        createdAt: row.createdAt.toISOString()
      }));
    });
  }

  async putGrant(userId: string, workspaceId: string, subjectId: string, granteeUserId: string, input: PutHealthGrantInput): Promise<HealthGrant> {
    return this.prisma.withUser(userId, async (tx) => {
      const subject = await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "own");
      if (granteeUserId === subject.userId || granteeUserId === subject.guardianUserId) {
        throw new BadRequestException("Доступ владельцу выдавать не нужно");
      }
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: granteeUserId } }, include: { user: { select: { name: true } } } });
      if (!member) throw new BadRequestException("Допустить можно только участника этого пространства");
      const row = await tx.healthGrant.upsert({
        where: { subjectId_granteeUserId: { subjectId, granteeUserId } },
        create: { workspaceId, subjectId, granteeUserId, level: input.level },
        update: { level: input.level }
      });
      return { subjectId, granteeUserId, granteeName: member.user?.name ?? "Участник", level: input.level, createdAt: row.createdAt.toISOString() };
    });
  }

  async removeGrant(userId: string, workspaceId: string, subjectId: string, granteeUserId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "own");
      const result = await tx.healthGrant.deleteMany({ where: { subjectId, granteeUserId } });
      if (result.count === 0) throw new NotFoundException("Допуск не найден");
    });
  }

  // ----------------------------------------------------------- appointments

  async listAppointments(userId: string, workspaceId: string, subjectId: string): Promise<HealthAppointment[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const rows = await tx.healthAppointment.findMany({ where: { subjectId }, orderBy: { at: "desc" }, take: 500 });
      return rows.map(appointmentDto);
    });
  }

  async createAppointment(userId: string, workspaceId: string, subjectId: string, input: CreateHealthAppointmentInput): Promise<HealthAppointment> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      await this.assertContactTx(tx, workspaceId, input.doctorContactId);
      const row = await tx.healthAppointment.create({
        data: {
          workspaceId,
          subjectId,
          title: input.title,
          at: new Date(input.at),
          doctorContactId: input.doctorContactId,
          clinic: input.clinic,
          purpose: input.purpose,
          questions: input.questions
        }
      });
      return appointmentDto(row);
    });
  }

  async updateAppointment(userId: string, workspaceId: string, subjectId: string, appointmentId: string, input: UpdateHealthAppointmentInput): Promise<HealthAppointment> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      if (input.doctorContactId !== undefined) await this.assertContactTx(tx, workspaceId, input.doctorContactId);
      const result = await tx.healthAppointment.updateMany({
        where: { id: appointmentId, subjectId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.at !== undefined ? { at: new Date(input.at) } : {}),
          ...(input.doctorContactId !== undefined ? { doctorContactId: input.doctorContactId } : {}),
          ...(input.clinic !== undefined ? { clinic: input.clinic } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.questions !== undefined ? { questions: input.questions } : {}),
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
          ...(input.doneAt !== undefined ? { doneAt: input.doneAt === null ? null : new Date(input.doneAt) } : {})
        }
      });
      if (result.count === 0) throw new NotFoundException("Визит не найден");
      return appointmentDto(await tx.healthAppointment.findUniqueOrThrow({ where: { id: appointmentId } }));
    });
  }

  async removeAppointment(userId: string, workspaceId: string, subjectId: string, appointmentId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const result = await tx.healthAppointment.deleteMany({ where: { id: appointmentId, subjectId } });
      if (result.count === 0) throw new NotFoundException("Визит не найден");
    });
  }

  // ------------------------------------------------------------- preventive

  async listPreventive(userId: string, workspaceId: string, subjectId: string): Promise<HealthPreventiveItem[]> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const rows = await tx.healthPreventiveItem.findMany({ where: { subjectId, archivedAt: null }, orderBy: { createdAt: "asc" }, take: 500 });
      return rows.map(preventiveDto);
    });
  }

  async createPreventive(userId: string, workspaceId: string, subjectId: string, input: CreateHealthPreventiveInput): Promise<HealthPreventiveItem> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const row = await tx.healthPreventiveItem.create({
        data: {
          workspaceId,
          subjectId,
          name: input.name,
          kind: input.kind,
          everyMonths: input.everyMonths,
          firstDueAt: input.firstDueAt ? dayDate(input.firstDueAt) : null,
          lastDoneAt: input.lastDoneAt ? dayDate(input.lastDoneAt) : null,
          note: input.note
        }
      });
      return preventiveDto(row);
    });
  }

  async updatePreventive(userId: string, workspaceId: string, subjectId: string, itemId: string, input: UpdateHealthPreventiveInput): Promise<HealthPreventiveItem> {
    return this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const result = await tx.healthPreventiveItem.updateMany({
        where: { id: itemId, subjectId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.everyMonths !== undefined ? { everyMonths: input.everyMonths } : {}),
          ...(input.firstDueAt !== undefined ? { firstDueAt: input.firstDueAt ? dayDate(input.firstDueAt) : null } : {}),
          ...(input.lastDoneAt !== undefined ? { lastDoneAt: input.lastDoneAt ? dayDate(input.lastDoneAt) : null } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt === null ? null : new Date(input.archivedAt) } : {})
        }
      });
      if (result.count === 0) throw new NotFoundException("Пункт не найден");
      return preventiveDto(await tx.healthPreventiveItem.findUniqueOrThrow({ where: { id: itemId } }));
    });
  }

  /** «Выполнено»: двигает `lastDoneAt`; следующий срок вычисляется, а не вводится руками. */
  async markPreventiveDone(userId: string, workspaceId: string, subjectId: string, itemId: string, input: MarkHealthPreventiveDoneInput): Promise<HealthPreventiveItem> {
    const doneOn = input.doneOn ?? dayString(new Date());
    return this.updatePreventive(userId, workspaceId, subjectId, itemId, { lastDoneAt: doneOn });
  }

  async removePreventive(userId: string, workspaceId: string, subjectId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.assertSubjectTx(tx, userId, workspaceId, subjectId, "write");
      const result = await tx.healthPreventiveItem.deleteMany({ where: { id: itemId, subjectId } });
      if (result.count === 0) throw new NotFoundException("Пункт не найден");
    });
  }

  // ------------------------------------------------------------------ today

  /** What needs attention across every person the caller may see. `today` is the client's day. */
  async today(userId: string, workspaceId: string, todayInput?: string): Promise<HealthToday> {
    const today = todayInput && TODAY_RE.test(todayInput) ? todayInput : dayString(new Date());
    return this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      const subjects = await tx.healthSubject.findMany({
        where: { workspaceId, archivedAt: null },
        include: { grants: { where: { granteeUserId: userId }, select: { level: true } } }
      });
      const names = new Map(subjects.map((s) => [s.id, s.name]));
      const ids = subjects.map((s) => s.id);
      if (ids.length === 0) return { appointments: [], preventive: [], doses: [] };

      const base = dayDate(today).getTime();
      const [appointments, items] = await Promise.all([
        tx.healthAppointment.findMany({
          where: { subjectId: { in: ids }, doneAt: null, at: { gte: new Date(base - 7 * DAY_MS), lt: new Date(base + 15 * DAY_MS) } },
          orderBy: { at: "asc" }
        }),
        tx.healthPreventiveItem.findMany({ where: { subjectId: { in: ids }, archivedAt: null } })
      ]);
      const preventive: HealthToday["preventive"] = [];
      for (const row of items) {
        const dto = preventiveDto(row);
        const status = preventiveStatus(dto.nextDueAt, today);
        if (status === "overdue" || status === "soon") preventive.push({ ...dto, status, subjectName: names.get(row.subjectId) ?? "" });
      }
      preventive.sort((a, b) => (a.nextDueAt ?? "").localeCompare(b.nextDueAt ?? ""));
      // Приёмы лекарств напоминаем только тем, кто их ведёт (сам человек, опекун, «ведёт вместе»), не наблюдателю.
      const writable = subjects.filter((s) => healthCanWrite(accessOf(s, userId) ?? "read")).map((s) => s.id);
      const doses = (await dosesForDayTx(tx, writable, today)).filter((d) => d.status === null).map((d) => ({ ...d, subjectName: names.get(d.subjectId) ?? "" }));
      return { appointments: appointments.map((row) => ({ ...appointmentDto(row), subjectName: names.get(row.subjectId) ?? "" })), preventive, doses };
    });
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Resolves the person and the caller's level. 404 when RLS hides them (or they belong to another workspace),
   * 403 when the caller sees them but the level is too low.
   */
  async assertSubjectTx(tx: Prisma.TransactionClient, userId: string, workspaceId: string, subjectId: string, need: Need): Promise<SubjectWithGrants> {
    await this.workspaces.assertMemberTx(tx, userId, workspaceId);
    const subject = await tx.healthSubject.findUnique({
      where: { id: subjectId },
      include: { grants: { where: { granteeUserId: userId }, select: { level: true } } }
    });
    const access = subject && subject.workspaceId === workspaceId ? accessOf(subject, userId) : null;
    if (!subject || !access) throw new NotFoundException("Человек не найден");
    const allowed = need === "read" ? true : need === "write" ? healthCanWrite(access) : access === "own";
    if (!allowed) throw new ForbiddenException(need === "own" ? "Это может делать только сам человек или его опекун" : "У вас доступ только на просмотр");
    return subject;
  }

  private async assertContactTx(tx: Prisma.TransactionClient, workspaceId: string, contactId: string | null): Promise<void> {
    if (!contactId) return;
    if (!await this.contacts.existsTx(tx, workspaceId, contactId)) throw new BadRequestException("Контакт не найден в этом пространстве");
  }
}

function accessOf(subject: SubjectWithGrants, userId: string): HealthAccess | null {
  if (subject.userId === userId || subject.guardianUserId === userId) return "own";
  const level = subject.grants[0]?.level;
  return level === "write" ? "write" : level === "read" ? "read" : null;
}

export function subjectDto(row: SubjectWithGrants, userId: string): HealthSubject {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.userId ? "member" : "dependent",
    userId: row.userId,
    guardianUserId: row.guardianUserId,
    name: row.name,
    birthDate: row.birthDate ? dayString(row.birthDate) : null,
    bloodType: row.bloodType,
    allergies: z.array(healthAllergySchema).catch([]).parse(row.allergies),
    conditions: z.array(z.string()).catch([]).parse(row.conditions),
    emergencyNote: row.emergencyNote,
    access: accessOf(row, userId) ?? "read",
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function appointmentDto(row: AppointmentRow): HealthAppointment {
  return {
    id: row.id,
    subjectId: row.subjectId,
    title: row.title,
    at: row.at.toISOString(),
    doctorContactId: row.doctorContactId,
    clinic: row.clinic,
    purpose: row.purpose,
    questions: row.questions,
    outcome: row.outcome,
    doneAt: row.doneAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function preventiveDto(row: PreventiveRow): HealthPreventiveItem {
  const firstDueAt = row.firstDueAt ? dayString(row.firstDueAt) : null;
  const lastDoneAt = row.lastDoneAt ? dayString(row.lastDoneAt) : null;
  return {
    id: row.id,
    subjectId: row.subjectId,
    name: row.name,
    kind: healthPreventiveKindSchema.catch("other").parse(row.kind),
    everyMonths: row.everyMonths,
    firstDueAt,
    lastDoneAt,
    nextDueAt: preventiveNextDue({ everyMonths: row.everyMonths, firstDueAt, lastDoneAt }),
    note: row.note,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
