"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  chatArchiveConversationSchema,
  chatArchiveImportResultSchema,
  chatArchiveImportStateSchema,
  chatArchiveLinesPageSchema,
  chatArchiveNoContentSchema,
  chatArchiveRawPageSchema,
  chatArchiveSearchHitSchema,
  sniffChatArchiveFile,
  type ChatArchiveConversation,
  type ChatArchiveLinesPage,
  type ChatArchiveSearchHit,
  type ChatArchiveSource
} from "@orion/shared-types";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Хуки модуля «Архив чатов». Ходят через `createModuleClient` поверх `ApiClient.extensionRequest` (G5/G24), поэтому модуль не правит
 * `@orion/core` / `@orion/core-react`. Ключи кэша — `["chat-archive", ...]`.
 */
type Api = Parameters<typeof createModuleClient>[0];
const client = (api: Api, workspaceId: string | undefined) => createModuleClient(api, workspaceModuleBase(workspaceId as string, "chat-archive"));

export function useChatArchiveConversations(workspaceId: string | undefined, source: ChatArchiveSource | undefined) {
  const { api } = useCore();
  return useQuery<ChatArchiveConversation[]>({
    queryKey: ["chat-archive", workspaceId, "conversations", source ?? "all"],
    queryFn: () => client(api, workspaceId).get(`/conversations${source ? `?source=${source}` : ""}`, chatArchiveConversationSchema.array()),
    enabled: Boolean(workspaceId)
  });
}

export function useChatArchiveLines(workspaceId: string | undefined, conversationId: string | undefined, messagesOnly: boolean) {
  const { api } = useCore();
  return useInfiniteQuery<ChatArchiveLinesPage>({
    queryKey: ["chat-archive", workspaceId, "lines", conversationId, messagesOnly],
    initialPageParam: -1,
    queryFn: ({ pageParam }) =>
      client(api, workspaceId).get(`/conversations/${conversationId}/lines?after=${pageParam as number}&limit=300&messagesOnly=${messagesOnly}`, chatArchiveLinesPageSchema),
    getNextPageParam: (last) => last.nextSeq ?? undefined,
    enabled: Boolean(workspaceId && conversationId)
  });
}

export function useChatArchiveSearch(workspaceId: string | undefined, q: string) {
  const { api } = useCore();
  const query = q.trim();
  return useQuery<ChatArchiveSearchHit[]>({
    queryKey: ["chat-archive", workspaceId, "search", query],
    queryFn: () => client(api, workspaceId).get(`/search?q=${encodeURIComponent(query)}&limit=60`, chatArchiveSearchHitSchema.array()),
    enabled: Boolean(workspaceId) && query.length >= 2
  });
}

/** Исходная строка как есть — по запросу, а не со страницей (бывает в сотни КБ). */
export async function fetchChatArchiveRawLine(api: Api, workspaceId: string, conversationId: string, seq: number): Promise<string> {
  const page = await client(api, workspaceId).get(`/conversations/${conversationId}/raw?only=${seq}`, chatArchiveRawPageSchema);
  return page.lines[0]?.raw ?? "";
}

/** Оригинал файла: строки по порядку, каждая с "\n" — байт в байт то, что было импортировано. */
export async function downloadChatArchiveOriginal(api: Api, workspaceId: string, conversation: ChatArchiveConversation): Promise<void> {
  const parts: string[] = [];
  let after = -1;
  for (;;) {
    const page = await client(api, workspaceId).get(`/conversations/${conversation.id}/raw?after=${after}`, chatArchiveRawPageSchema);
    for (const line of page.lines) parts.push(`${line.raw}\n`);
    if (page.nextSeq === null) break;
    after = page.nextSeq;
  }
  const url = URL.createObjectURL(new Blob(parts, { type: "application/x-ndjson" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${conversation.externalId}.jsonl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useRenameChatArchiveConversation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => client(api, workspaceId).patch(`/conversations/${id}`, { title }, chatArchiveConversationSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-archive", workspaceId, "conversations"] })
  });
}

export function useDeleteChatArchiveConversation(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client(api, workspaceId).delete(`/conversations/${id}`, chatArchiveNoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-archive", workspaceId] })
  });
}

const BATCH_LINES = 2000;
const BATCH_BYTES = 7 * 1024 * 1024;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface ChatArchiveFileImport {
  conversationId: string;
  title: string;
  appended: number;
  /** Последняя строка файла без перевода строки — агент ещё пишет её; уйдёт при следующем импорте. */
  tornTail: boolean;
}

/**
 * Импорт файла транскрипта из панели — тот же протокол, что у хука: продолжить с `lineCount` сервера, сверив хеш последней
 * сохранённой строки, и слать хвост пачками.
 */
export function useImportChatArchiveFile(workspaceId: string | undefined, onProgress?: (done: number, total: number) => void) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<ChatArchiveFileImport> => {
      const parts = (await file.text()).split("\n");
      const tail = parts.pop() ?? "";
      const lines = parts;
      const id = sniffChatArchiveFile(lines);
      if (!id) throw new Error("Это не похоже на транскрипт Claude Code или Codex (.jsonl)");
      const query = `source=${id.source}&externalId=${encodeURIComponent(id.externalId)}`;
      const archive = client(api, workspaceId);
      const state = await archive.get(`/import-state?${query}`, chatArchiveImportStateSchema);
      if (state.lineCount > lines.length) throw new Error(`В архиве уже ${state.lineCount} строк, а в файле ${lines.length} — это более старая копия`);
      if (state.lineCount > 0 && (await sha256(lines[state.lineCount - 1]!)) !== state.lastSha) {
        throw new Error("Файл не совпадает с сохранённым разговором: он изменился не дописыванием");
      }
      let appended = 0;
      let title = "";
      let conversationId = state.conversationId ?? "";
      let start = state.lineCount;
      onProgress?.(start, lines.length);
      while (start < lines.length) {
        let end = start;
        let bytes = 0;
        while (end < lines.length && end - start < BATCH_LINES) {
          const size = new TextEncoder().encode(lines[end]!).length + 1;
          if (end > start && bytes + size > BATCH_BYTES) break;
          bytes += size;
          end += 1;
        }
        const form = new FormData();
        form.append("lines", new Blob([lines.slice(start, end).map((line) => `${line}\n`).join("")], { type: "application/x-ndjson" }), "lines.jsonl");
        const path = `/import?${query}&fromSeq=${start}${id.projectPath ? `&projectPath=${encodeURIComponent(id.projectPath)}` : ""}`;
        const result = await archive.post(path, form, chatArchiveImportResultSchema);
        appended += result.appended;
        title = result.conversation.title;
        conversationId = result.conversation.id;
        start = end;
        onProgress?.(start, lines.length);
      }
      return { conversationId, title, appended, tornTail: tail !== "" };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["chat-archive", workspaceId] })
  });
}
