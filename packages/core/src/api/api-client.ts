import {
  authResponseSchema,
  noteSchema,
  workspaceSchema,
  type AuthResponse,
  type CreateNoteInput,
  type LoginInput,
  type Note,
  type RegisterInput,
  type UpdateNoteInput,
  type Workspace
} from "@orion/shared-types";
import { z } from "zod";
import type { TokenStore } from "../auth/token-store";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  tokenStore: TokenStore;
}

/**
 * Typed fetch client for the ORION API. Framework-agnostic — no React,
 * no DOM assumptions beyond a global fetch (present in browsers, Node 18+,
 * and the Tauri webview alike).
 */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const data = await this.request("POST", "/auth/register", input, authResponseSchema);
    await this.options.tokenStore.set(data.accessToken);
    return data;
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const data = await this.request("POST", "/auth/login", input, authResponseSchema);
    await this.options.tokenStore.set(data.accessToken);
    return data;
  }

  async logout(): Promise<void> {
    await this.options.tokenStore.clear();
  }

  me(): Promise<{ id: string; email: string; name: string }> {
    return this.request("GET", "/auth/me", undefined, z.object({ id: z.string(), email: z.string(), name: z.string() }));
  }

  listWorkspaces(): Promise<Workspace[]> {
    return this.request("GET", "/workspaces/me", undefined, z.array(workspaceSchema));
  }

  listNotes(workspaceId: string): Promise<Note[]> {
    return this.request("GET", `/workspaces/${workspaceId}/notes`, undefined, z.array(noteSchema));
  }

  createNote(workspaceId: string, input: CreateNoteInput): Promise<Note> {
    return this.request("POST", `/workspaces/${workspaceId}/notes`, input, noteSchema);
  }

  updateNote(workspaceId: string, noteId: string, input: UpdateNoteInput): Promise<Note> {
    return this.request("PATCH", `/workspaces/${workspaceId}/notes/${noteId}`, input, noteSchema);
  }

  async deleteNote(workspaceId: string, noteId: string): Promise<void> {
    await this.request("DELETE", `/workspaces/${workspaceId}/notes/${noteId}`, undefined, z.unknown());
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    schema: z.ZodType<T>
  ): Promise<T> {
    const token = await this.options.tokenStore.get();
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = await safeJson(response);
      throw new ApiError(response.status, extractMessage(payload) ?? response.statusText, payload);
    }

    if (response.status === 204) {
      return schema.parse(undefined);
    }

    const json = await safeJson(response);
    return schema.parse(json);
  }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message: unknown }).message;
    return typeof message === "string" ? message : JSON.stringify(message);
  }
  return undefined;
}
