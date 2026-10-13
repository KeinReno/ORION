import { z } from "zod";

/**
 * A thought pinned to one project. An idea is "I should build this"; a problem
 * is "this is wrong, broken, or needs a fix". Neither is a task until the user
 * asks to make one — see `status: "promoted"` and `taskId`.
 */
export const projectCaptureKindSchema = z.enum(["idea", "problem"]);
export type ProjectCaptureKind = z.infer<typeof projectCaptureKindSchema>;

export const projectCaptureStatusSchema = z.enum(["open", "promoted", "dismissed"]);
export type ProjectCaptureStatus = z.infer<typeof projectCaptureStatusSchema>;

/** Problems only. Ideas store null. */
export const projectCaptureSeveritySchema = z.enum(["annoyance", "bug", "fix"]);
export type ProjectCaptureSeverity = z.infer<typeof projectCaptureSeveritySchema>;

export const PROJECT_CAPTURE_SEVERITY_LABEL: Record<ProjectCaptureSeverity, string> = {
  annoyance: "Не нравится",
  bug: "Баг",
  fix: "Поправить"
};

export const PROJECT_CAPTURE_STATUS_LABEL: Record<ProjectCaptureStatus, string> = {
  open: "Открыта",
  promoted: "В задаче",
  dismissed: "Закрыта"
};

export const projectCaptureSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  kind: projectCaptureKindSchema,
  title: z.string(),
  body: z.string(),
  status: projectCaptureStatusSchema,
  severity: projectCaptureSeveritySchema.nullable(),
  taskId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type ProjectCapture = z.infer<typeof projectCaptureSchema>;

export const createProjectCaptureInputSchema = z.object({
  title: z.string().trim().min(1, "Заголовок обязателен").max(200),
  body: z.string().max(20_000).default("")
});
export type CreateProjectCaptureInput = z.infer<typeof createProjectCaptureInputSchema>;

export const createProjectProblemInputSchema = createProjectCaptureInputSchema.extend({
  severity: projectCaptureSeveritySchema.default("annoyance")
});
export type CreateProjectProblemInput = z.infer<typeof createProjectProblemInputSchema>;

/** `promoted` is not set from here — only the promote action creates the task. */
export const updateProjectCaptureInputSchema = z.object({
  title: z.string().trim().min(1, "Заголовок обязателен").max(200).optional(),
  body: z.string().max(20_000).optional(),
  status: z.enum(["open", "dismissed"]).optional(),
  severity: projectCaptureSeveritySchema.optional()
});
export type UpdateProjectCaptureInput = z.infer<typeof updateProjectCaptureInputSchema>;
