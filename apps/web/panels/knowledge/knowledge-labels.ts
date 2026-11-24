import {
  KNOWLEDGE_KINDS,
  KNOWLEDGE_RELATION_KINDS,
  KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES,
  type KnowledgeKind,
  type KnowledgeRelationKind,
  type KnowledgeSourceType,
  type KnowledgeStatus
} from "@orion/shared-types";
import { BookOpen, FileText, Link2, Lightbulb, Wrench } from "lucide-react";

/**
 * One place for every label/tone used across the Knowledge module (list, editor, reading view) —
 * `STATUS_LABEL` used to be copy-pasted between `KnowledgePanel.tsx` and `item-editor.tsx`.
 */

export const STATUS_LABEL: Record<KnowledgeStatus, string> = {
  captured: "Сырьё",
  draft: "Черновик",
  review: "На проверке",
  approved: "Принято",
  published: "Опубликовано",
  archived: "Архив"
};

export const STATUS_TONE: Record<KnowledgeStatus, "neutral" | "accent" | "warning" | "success"> = {
  captured: "neutral",
  draft: "neutral",
  review: "warning",
  approved: "accent",
  published: "success",
  archived: "neutral"
};

export const KIND_LABEL: Record<KnowledgeKind, string> = {
  method: "Методика",
  tool: "Инструмент",
  fact: "Факт",
  opinion: "Мнение",
  link: "Ссылка"
};

export const KIND_ICON: Record<KnowledgeKind, React.ComponentType<{ className?: string }>> = {
  method: BookOpen,
  tool: Wrench,
  fact: FileText,
  opinion: Lightbulb,
  link: Link2
};

/** Цвет типа материала (чипы, иконки источников). Тонированные фоны — цвет + «1F». */
export const KIND_COLOR: Record<KnowledgeKind, string> = {
  method: "#C9A86A",
  tool: "#A78BFA",
  fact: "#60A5FA",
  opinion: "#F59E0B",
  link: "#34D399"
};

export const SOURCE_LABEL: Record<KnowledgeSourceType, string> = {
  url: "Ссылка",
  note: "Заметка",
  document: "Документ",
  manual: "Запись",
  other: "Другое"
};

export const RELATION_LABEL: Record<KnowledgeRelationKind, string> = {
  related: "Связано",
  expands: "Развивает",
  contradicts: "Противоречит",
  duplicate_of: "Дубликат",
  derived_from: "Выведено из",
  part_of: "Часть"
};

export const VISIBILITY_LABEL = { private: "Только я", workspace: "Пространство" } as const;

export { KNOWLEDGE_KINDS, KNOWLEDGE_RELATION_KINDS, KNOWLEDGE_SOURCE_TYPES, KNOWLEDGE_STATUSES };
