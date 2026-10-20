/** Типы чистых помощников `chat-archive-push.mjs` (скрипт — обычный Node ESM, без сборки) для его теста. */

export const MAX_BATCH_LINES: number;
export const MAX_BATCH_BYTES: number;

export function completeLines(text: string): string[];
export function sha256(text: string): string;
export function planBatches(lines: readonly string[], from: number, maxLines?: number, maxBytes?: number): Array<{ from: number; to: number; bytes: number }>;
export function identify(file: string, lines: readonly string[]): { source: "claude-code" | "codex"; externalId: string } | null;
export function resolveConnection(
  env?: Record<string, string | undefined>,
  home?: string,
  read?: (path: string) => string | null
): { apiUrl: string; token: string; from: string } | null;
export function parseArgs(argv: readonly string[]): { files: string[]; all: boolean; hook: boolean; sourceFilter?: string; sinceDays?: number };
export function discoverTranscripts(home?: string, env?: Record<string, string | undefined>): string[];
