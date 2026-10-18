import type { ComponentDataState, ComponentDataStatus } from "./component-data";
import { PLATFORM_API_VERSION, satisfiesVersionRange, type ComponentManifest } from "./component-manifest";
import type { BackgroundJobStatus } from "./settings";

/**
 * G16 — строка менеджера компонентов: версия, совместимость, граф жёстких зависимостей, состояние данных (G11) и сбои
 * фоновых задач (G9) одного компонента. Чистая функция: экран и тест видят один и тот же ответ.
 */
export interface ComponentDiagnosticsRow {
  id: string;
  kind: ComponentManifest["kind"];
  title: string;
  version: string;
  /** `requires.platform` удовлетворён текущей платформой. */
  compatible: boolean;
  /** Жёсткие зависимости (id модулей). */
  requires: string[];
  /** Компоненты, которым этот нужен жёстко. */
  dependents: string[];
  /** `none` — у компонента нет собственных миграций. */
  data: ComponentDataState | "none";
  jobFailures: number;
  lastJobError: string | null;
  /** Человекочитаемые проблемы; пусто — всё в порядке. */
  problems: string[];
}

export function buildComponentDiagnostics(
  manifests: readonly ComponentManifest[],
  dataStatuses: readonly ComponentDataStatus[],
  jobs: readonly BackgroundJobStatus[]
): ComponentDiagnosticsRow[] {
  const dataById = new Map(dataStatuses.map((item) => [item.componentId, item]));
  const rows = manifests.map((manifest): ComponentDiagnosticsRow => {
    const platformOk = satisfiesVersionRange(manifest.requires.platform, PLATFORM_API_VERSION);
    // Сверка `requires.contracts` (G2) добавится вместе с PR версий контрактов.
    const compatible = platformOk;
    const data = dataById.get(manifest.id);
    const ownJobs = jobs.filter((job) => job.componentId === manifest.id);
    const jobFailures = ownJobs.reduce((sum, job) => sum + job.failures, 0);
    const lastJobError = ownJobs.find((job) => job.lastError)?.lastError ?? null;
    const dependents = manifests.filter((other) => other.requires.modules.includes(manifest.id)).map((other) => other.id);

    const problems: string[] = [];
    if (!platformOk) problems.push(`Нужна платформа ${manifest.requires.platform}, установлена ${PLATFORM_API_VERSION}`);
    if (data?.state === "pending") problems.push(`Не применены миграции: ${data.pending.join(", ")}`);
    if (data?.state === "failed") problems.push(`Миграция не завершена: ${data.failed.join(", ")}`);
    if (data?.state === "unknown") problems.push("Состояние миграций неизвестно");
    if (jobFailures > 0) problems.push(`Сбои фоновых задач: ${jobFailures}${lastJobError ? ` (${lastJobError})` : ""}`);

    return {
      id: manifest.id,
      kind: manifest.kind,
      title: manifest.title,
      version: manifest.version,
      compatible,
      requires: [...manifest.requires.modules],
      dependents,
      data: data?.state ?? "none",
      jobFailures,
      lastJobError,
      problems
    };
  });
  // Сначала проблемные, дальше модули перед плагинами, затем по названию.
  return rows.sort(
    (a, b) =>
      Number(b.problems.length > 0) - Number(a.problems.length > 0) ||
      (a.kind === b.kind ? 0 : a.kind === "module" ? -1 : 1) ||
      a.title.localeCompare(b.title, "ru")
  );
}
