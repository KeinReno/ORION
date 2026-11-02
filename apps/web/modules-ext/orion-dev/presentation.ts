import type { DevelopmentPreviewResponse, Project, Task } from "@orion/shared-types";

export const phases = [
  { id: "foundation", title: "Надёжность", description: "Стабильная основа: ядро, синхронизация, данные и права доступа." },
  { id: "architecture", title: "Архитектура", description: "Контракты модулей и безопасное расширение платформы." },
  { id: "agents", title: "Агенты", description: "Выполнение задач, доказательства и независимая приёмка." },
  { id: "features", title: "Возможности", description: "Развитие повседневных инструментов Orion." },
  { id: "product", title: "Продукт", description: "Desktop, Android, удобство работы и подготовка релизов." }
] as const;

const projects: Record<string, [string, string]> = {
  core: ["Ядро платформы", "События и границы модулей"], sync: ["Синхронизация", "Обмен данными между устройствами"],
  security: ["Безопасность", "Права пространств и доступ агентов"], qa: ["Качество", "Тесты и воспроизводимые проверки"],
  data: ["Данные", "Миграции, резервные копии и восстановление"], modules: ["Модули", "Жизненный цикл и возможности модулей"],
  plugins: ["Плагины", "Расширения и их контракты"], agents: ["Агенты", "Надёжное выполнение и приёмка"],
  ai: ["AI-интеграции", "Контракты подключения IDE-агентов"], desktop: ["Desktop", "Центр управления разработкой"],
  mobile: ["Android", "Проверка мобильного приложения"], ux: ["Интерфейс", "Понятные и согласованные сценарии"],
  release: ["Релизы", "Предварительные сборки и выпуск беты"]
};
const tasks: Record<string, string> = {
  "DEV-001": "Проверить границы ядра и модулей", "DEV-002": "Сделать CI воспроизводимым и стабильным",
  "DEV-003": "Проверить синхронизацию и восстановление конфликтов", "DEV-004": "Проверить миграции и восстановление данных",
  "DEV-005": "Проверить права пространств и доступ агентов", "DEV-006": "Завершить контракты и жизненный цикл модулей",
  "DEV-007": "Определить жизненный цикл сторонних плагинов", "DEV-008": "Создать надёжный диспетчер задач агентов",
  "DEV-009": "Связать доказательства с независимой приёмкой", "DEV-010": "Унифицировать контракты IDE-агентов",
  "DEV-011": "Создать центр управления разработкой", "DEV-012": "Проверить Android и исправления взаимодействий",
  "DEV-013": "Согласовать интерфейс управления разработкой", "DEV-014": "Настроить проверку сборки перед выпуском беты",
  "DEV-015": "Разделить срочность, важность, срок и приоритет", "DEV-016": "Завершить редактирование таблиц документов"
};

export function displayTitle(kind: "project" | "task", externalId: string, source: string, actual = source): string {
  // A human rename always wins. These labels are presentation only.
  return actual !== source ? actual : (kind === "project" ? projects[externalId]?.[0] : tasks[externalId]) ?? actual;
}
export function projectDescription(externalId: string): string { return projects[externalId]?.[1] ?? "Проект разработки"; }
export const statusLabels: Record<Task["status"], string> = {
  backlog: "В планах", todo: "К выполнению", in_progress: "В работе", done: "Завершена", canceled: "Отменена"
};

export function buildOverview(preview: DevelopmentPreviewResponse, projects: Project[], tasks: Task[]) {
  const projectById = new Map(projects.map(item => [item.id, item]));
  const taskById = new Map(tasks.map(item => [item.id, item]));
  const rows = preview.plan.actions.map(action => {
    const entity = action.action === "already_mapped" && action.candidateId
      ? action.kind === "project" ? projectById.get(action.candidateId) : taskById.get(action.candidateId) : undefined;
    const phase = action.kind === "project" ? preview.catalog.projects?.find(item => item.id === action.externalId)?.phase
      : preview.catalog.workItems.find(item => item.id === action.externalId)?.phase;
    return { ...action, entity, phase, label: displayTitle(action.kind, action.externalId, action.title,
      entity ? "name" in entity ? entity.name : entity.title : action.title) };
  });
  return {
    projects: rows.filter(row => row.kind === "project").map(row => ({ ...row, entity: row.entity as Project | undefined })),
    tasks: rows.filter(row => row.kind === "task").map(row => ({ ...row, entity: row.entity as Task | undefined })),
    unmapped: rows.filter(row => row.action !== "already_mapped").length,
    missing: rows.filter(row => row.action === "already_mapped" && !row.entity).length
  };
}
