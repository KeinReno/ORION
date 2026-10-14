import { z } from "zod";
import { projectCaptureSeveritySchema, projectCaptureStatusSchema } from "./project-capture";

/**
 * Universal Capture: a short thought (idea / problem / note-to-self) anchored to
 * any ORION object or to nothing. It is never a task until the user asks —
 * `promote` creates one and the capture stays, with `taskId` pointing at it.
 */
export const captureKindSchema = z.enum(["idea", "problem", "note"]);
export type CaptureKind = z.infer<typeof captureKindSchema>;

export const CAPTURE_KIND_LABEL: Record<CaptureKind, string> = {
  idea: "Идея",
  problem: "Проблема",
  note: "Заметка"
};

/** Objects a capture can hang on. Each must belong to the same workspace (checked by the API). */
export const CAPTURE_ANCHOR_TYPES = ["project", "task", "goal", "home", "account", "obligation", "contact"] as const;
export const captureAnchorTypeSchema = z.enum(CAPTURE_ANCHOR_TYPES);
export type CaptureAnchorType = z.infer<typeof captureAnchorTypeSchema>;

export const CAPTURE_ANCHOR_LABEL: Record<CaptureAnchorType, string> = {
  project: "Проект",
  task: "Задача",
  goal: "Цель",
  home: "Дом",
  account: "Счёт",
  obligation: "Обязательство",
  contact: "Контакт"
};

export const captureStatusSchema = projectCaptureStatusSchema;
export const captureSeveritySchema = projectCaptureSeveritySchema;

export const captureSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  anchorType: captureAnchorTypeSchema.nullable(),
  anchorId: z.string().nullable(),
  kind: captureKindSchema,
  title: z.string(),
  body: z.string(),
  status: captureStatusSchema,
  severity: captureSeveritySchema.nullable(),
  taskId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Capture = z.infer<typeof captureSchema>;

/** The anchor is a pair: both fields or neither. */
export const createCaptureInputSchema = z
  .object({
    kind: captureKindSchema,
    title: z.string().trim().min(1, "Заголовок обязателен").max(200),
    body: z.string().max(20_000).default(""),
    severity: captureSeveritySchema.optional(),
    anchorType: captureAnchorTypeSchema.nullish(),
    anchorId: z.string().min(1).nullish()
  })
  .refine((v) => Boolean(v.anchorType) === Boolean(v.anchorId), {
    message: "Укажите тип и id объекта вместе или не указывайте оба",
    path: ["anchorId"]
  });
export type CreateCaptureInput = z.infer<typeof createCaptureInputSchema>;

/** `promoted` is not set from here — only the promote action creates the task. */
export const updateCaptureInputSchema = z.object({
  title: z.string().trim().min(1, "Заголовок обязателен").max(200).optional(),
  body: z.string().max(20_000).optional(),
  status: z.enum(["open", "dismissed"]).optional(),
  severity: captureSeveritySchema.optional(),
  /** Move the capture to another object (or `null` + `null` to detach it). The pair is both-or-neither. */
  anchorType: captureAnchorTypeSchema.nullish(),
  anchorId: z.string().min(1).nullish()
}).refine((v) => (v.anchorType === undefined && v.anchorId === undefined) || Boolean(v.anchorType) === Boolean(v.anchorId), {
  message: "Укажите тип и id объекта вместе или не указывайте оба",
  path: ["anchorId"]
});
export type UpdateCaptureInput = z.infer<typeof updateCaptureInputSchema>;

/**
 * List filter. `anchorType=none` means "only captures without an anchor";
 * leaving both anchor fields out means "all captures of the workspace".
 */
export const listCapturesQuerySchema = z
  .object({
    anchorType: z.union([captureAnchorTypeSchema, z.literal("none")]).optional(),
    anchorId: z.string().min(1).optional(),
    kind: captureKindSchema.optional(),
    status: captureStatusSchema.optional()
  })
  .refine((v) => (v.anchorType && v.anchorType !== "none" ? Boolean(v.anchorId) : !v.anchorId), {
    message: "anchorId нужен ровно тогда, когда указан тип объекта",
    path: ["anchorId"]
  });
export type ListCapturesQuery = z.infer<typeof listCapturesQuerySchema>;

/** Severity is a property of problems only; other kinds never store one. */
export function effectiveCaptureSeverity(kind: CaptureKind, severity: z.infer<typeof captureSeveritySchema> | undefined) {
  return kind === "problem" ? (severity ?? "annoyance") : null;
}
