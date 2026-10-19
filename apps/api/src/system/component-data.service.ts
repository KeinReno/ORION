import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { COMPONENT_MANIFESTS, componentDataStatus, type AppliedMigrationRow, type ComponentDataStatus } from "@orion/shared-types";
import { PrismaService } from "../common/prisma.service";

/**
 * G11 — совместимость «код ↔ база» для компонентов с собственными миграциями. Сравнивает `migrations` манифестов
 * с `_prisma_migrations`. Миграции по-прежнему применяет `prisma migrate deploy`, не API: здесь только диагностика,
 * чтобы неприменённая миграция модуля была видна сразу, а не первой ошибкой на запросе к его таблице.
 */
@Injectable()
export class ComponentDataService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ComponentDataService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const problems = (await this.list()).filter((item) => item.state === "pending" || item.state === "failed");
    for (const item of problems) {
      this.logger.warn(`Данные компонента «${item.componentId}»: ${item.state}; миграции: ${[...item.failed, ...item.pending].join(", ")}. Выполните prisma migrate deploy.`);
    }
  }

  /** Компоненты, у которых есть миграции. Прочитать таблицу миграций не удалось → `unknown`, а не «ок». */
  async list(): Promise<ComponentDataStatus[]> {
    const components = COMPONENT_MANIFESTS.filter((manifest) => manifest.migrations.length > 0);
    if (components.length === 0) return [];
    const rows = await this.readApplied();
    return components.map((manifest) => componentDataStatus(manifest.id, manifest.migrations, rows));
  }

  private async readApplied(): Promise<AppliedMigrationRow[] | null> {
    try {
      // Служебная таблица Prisma вне RLS; читает роль orion_system, как и остальные межпространственные запросы.
      return await this.prisma.asSystem((tx) =>
        tx.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
          SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
        `
      ).then((rows) => rows.map((row) => ({ name: row.migration_name, finishedAt: row.finished_at, rolledBackAt: row.rolled_back_at })));
    } catch (error) {
      this.logger.warn(`Не удалось прочитать _prisma_migrations: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
