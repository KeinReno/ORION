import { z } from "zod";

export const PROJECT_LOG_KINDS = ["observation", "decision", "change"] as const;
export const projectLogKindSchema = z.enum(PROJECT_LOG_KINDS);
export type ProjectLogKind = z.infer<typeof projectLogKindSchema>;
export const PROJECT_LOG_KIND_LABEL: Record<ProjectLogKind, string> = {
  observation: "Наблюдение",
  decision: "Решение",
  change: "Изменение"
};

export const projectLogTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  comment: z.string(),
  url: z.string().nullable()
});
export type ProjectLogTask = z.infer<typeof projectLogTaskSchema>;

export const projectLogEntrySchema = z.object({
  id: z.string(), workspaceId: z.string(), projectId: z.string(), kind: projectLogKindSchema,
  text: z.string(), authorId: z.string(), authorName: z.string(), mine: z.boolean(),
  createdAt: z.string(), tasks: z.array(projectLogTaskSchema)
});
export type ProjectLogEntry = z.infer<typeof projectLogEntrySchema>;

export const createProjectLogEntryInputSchema = z.object({
  kind: projectLogKindSchema,
  text: z.string().trim().min(1, "Добавьте запись").max(5000),
  tasks: z.array(z.object({ taskId: z.string().uuid(), comment: z.string().trim().max(2000).default("") }).strict()).max(20).default([])
}).strict().refine((value) => new Set(value.tasks.map((item) => item.taskId)).size === value.tasks.length, "Одна задача указана несколько раз");
export type CreateProjectLogEntryInput = z.infer<typeof createProjectLogEntryInputSchema>;

export const PROJECT_RELATION_TYPES = ["continues", "replaces", "based_on", "depends_on", "related"] as const;
export const projectRelationTypeSchema = z.enum(PROJECT_RELATION_TYPES);
export type ProjectRelationType = z.infer<typeof projectRelationTypeSchema>;
export const PROJECT_RELATION_LABEL: Record<ProjectRelationType, string> = {
  continues: "Продолжает",
  replaces: "Заменяет",
  based_on: "Создан на основе",
  depends_on: "Зависит от",
  related: "Связан с"
};
export const projectRelationSchema = z.object({
  id: z.string(), type: projectRelationTypeSchema, fromProjectId: z.string(), toProjectId: z.string(),
  fromProjectName: z.string(), toProjectName: z.string(), createdAt: z.string(), mine: z.boolean()
});
export type ProjectRelation = z.infer<typeof projectRelationSchema>;
export const createProjectRelationInputSchema = z.object({
  type: projectRelationTypeSchema, toProjectId: z.string().uuid()
}).strict();
export type CreateProjectRelationInput = z.infer<typeof createProjectRelationInputSchema>;
