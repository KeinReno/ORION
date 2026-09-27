import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  type LucideIcon
} from "lucide-react";
import type { DocumentItem } from "@orion/shared-types";

/** Coarse type buckets used by the panel's filter chips. */
export type DocGroup = "folder" | "document" | "image" | "pdf" | "sheet" | "media" | "archive" | "code" | "other";

export const DOC_GROUP_LABEL: Record<DocGroup, string> = {
  folder: "Папки",
  document: "Документы",
  image: "Изображения",
  pdf: "PDF",
  sheet: "Таблицы",
  media: "Медиа",
  archive: "Архивы",
  code: "Код",
  other: "Прочее"
};

const EXT = (name: string): string => name.toLowerCase().split(".").pop() ?? "";

export function documentGroup(doc: Pick<DocumentItem, "kind" | "name" | "mimeType">): DocGroup {
  if (doc.kind === "folder") return "folder";
  const m = (doc.mimeType ?? "").toLowerCase();
  const ext = EXT(doc.name);
  if (m === "application/pdf" || ext === "pdf") return "pdf";
  if (m.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico", "tiff"].includes(ext)) return "image";
  if (m.startsWith("video/") || m.startsWith("audio/") || ["mp4", "webm", "mov", "mkv", "mp3", "wav", "ogg", "flac", "m4a", "aac"].includes(ext)) return "media";
  if (
    m.includes("spreadsheetml") ||
    m === "application/vnd.ms-excel" ||
    m === "text/csv" ||
    ["xlsx", "xls", "csv", "tsv", "ods"].includes(ext)
  ) {
    return "sheet";
  }
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) return "archive";
  if (
    ["js", "jsx", "ts", "tsx", "json", "html", "css", "scss", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "cs", "sh", "sql", "xml", "yml", "yaml", "toml"].includes(ext)
  ) {
    return "code";
  }
  if (
    m.includes("wordprocessingml") ||
    m === "application/msword" ||
    m.startsWith("text/") ||
    ["doc", "docx", "rtf", "odt", "txt", "md", "markdown", "pages"].includes(ext)
  ) {
    return "document";
  }
  return "other";
}

const GROUP_ICON: Record<DocGroup, LucideIcon> = {
  folder: Folder,
  document: FileText,
  image: FileImage,
  pdf: FileText,
  sheet: FileSpreadsheet,
  media: FileVideo,
  archive: FileArchive,
  code: FileCode,
  other: FileIcon
};

export function documentIcon(doc: Pick<DocumentItem, "kind" | "name" | "mimeType">): LucideIcon {
  const group = documentGroup(doc);
  if (group === "media") {
    return (doc.mimeType ?? "").startsWith("audio/") ? FileAudio : FileVideo;
  }
  return GROUP_ICON[group];
}

/** `1536` → `1,5 КБ`. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} Б`;
  const units = ["КБ", "МБ", "ГБ", "ТБ"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace(".", ",")} ${units[unit]}`;
}
