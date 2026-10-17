import { Injectable } from "@nestjs/common";
import { HEALTH_MEASUREMENT_KINDS, type HealthSummary } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";
import { dayString } from "./health-doses";
import { measurementDto, targetDto } from "./health-measurements.service";
import { medicationDto } from "./health-medications.service";
import { symptomDto } from "./health-symptoms.service";
import { appointmentDto, HealthService, subjectDto } from "./health.service";

const SYMPTOM_WINDOW_DAYS = 90;
const RECENT_PER_KIND = 5;

/**
 * Сводка по человеку для карточки врача и экстренной карточки: одна проверка доступа (`read`) и один ответ.
 * Ничего не пишет и никуда не отправляется — печатает и показывает клиент по нажатию.
 */
@Injectable()
export class HealthSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService
  ) {}

  async summary(userId: string, workspaceId: string, subjectId: string): Promise<HealthSummary> {
    const now = new Date();
    const today = dayString(now);
    return this.prisma.withUser(userId, async (tx) => {
      const subject = await this.health.assertSubjectTx(tx, userId, workspaceId, subjectId, "read");
      const [medications, perKind, targets, upcoming, recent, symptoms] = await Promise.all([
        tx.healthMedication.findMany({ where: { subjectId, archivedAt: null }, orderBy: { name: "asc" } }),
        Promise.all(HEALTH_MEASUREMENT_KINDS.map((kind) => tx.healthMeasurement.findMany({ where: { subjectId, kind }, orderBy: { measuredAt: "desc" }, take: RECENT_PER_KIND }))),
        tx.healthTarget.findMany({ where: { subjectId } }),
        tx.healthAppointment.findMany({ where: { subjectId, doneAt: null, at: { gte: now } }, orderBy: { at: "asc" }, take: 3 }),
        tx.healthAppointment.findMany({ where: { subjectId, doneAt: { not: null } }, orderBy: { at: "desc" }, take: 5 }),
        tx.healthSymptom.findMany({
          where: { subjectId, OR: [{ startedAt: { gte: new Date(now.getTime() - SYMPTOM_WINDOW_DAYS * 86_400_000) } }, { endedAt: null }] },
          orderBy: { startedAt: "desc" },
          take: 30
        })
      ]);
      const targetByKind = new Map(targets.map((t) => [t.kind, targetDto(t)]));
      return {
        generatedAt: now.toISOString(),
        subject: subjectDto(subject, userId),
        // Принимаемое сейчас: курс уже начался и ещё не закончился.
        medications: medications
          .filter((m) => (!m.startOn || dayString(m.startOn) <= today) && (!m.endOn || dayString(m.endOn) >= today))
          .map((m) => medicationDto(m, { planned: 0, taken: 0, skipped: 0 })),
        measurements: HEALTH_MEASUREMENT_KINDS.flatMap((kind, index) => {
          const rows = perKind[index];
          return rows.length === 0 ? [] : [{ kind, latest: measurementDto(rows[0]), recent: rows.map(measurementDto), target: targetByKind.get(kind) ?? null }];
        }),
        upcomingAppointments: upcoming.map(appointmentDto),
        recentAppointments: recent.map(appointmentDto),
        symptoms: symptoms.map(symptomDto)
      };
    });
  }
}
