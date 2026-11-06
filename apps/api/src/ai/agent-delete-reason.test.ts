import { agentDeleteRequestSchema } from "@orion/shared-types";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { applyAgentDeleteReason, type AgentDeleteReasonRequest } from "./agent-delete-reason";
import { AgentDeleteReasonInterceptor } from "./agent-delete-reason.interceptor";

/** What the module controllers do: the zod body pipe, then `body.reason`. */
function reasonReadFromBody(body: unknown): string {
  return agentDeleteRequestSchema.parse(body).reason;
}

/** What task/note/event deletes do: `@Query("reason")`. */
function reasonReadFromQuery(query: { reason?: unknown }): unknown {
  return query.reason;
}

describe("applyAgentDeleteReason", () => {
  it("причина только в query видна читателю тела, и только в теле — читателю query", () => {
    const fromQuery: AgentDeleteReasonRequest = {
      method: "DELETE",
      originalUrl: "/ai/v1/documents/d1?reason=из+строки",
      query: { reason: "из строки" },
      body: {}
    };
    applyAgentDeleteReason(fromQuery);
    expect(reasonReadFromBody(fromQuery.body)).toBe("из строки");

    const fromBody: AgentDeleteReasonRequest = {
      method: "DELETE",
      originalUrl: "/ai/v1/tasks/t1",
      query: {},
      body: { reason: "из тела" }
    };
    applyAgentDeleteReason(fromBody);
    expect(reasonReadFromQuery(fromBody.query!)).toBe("из тела");
  });

  it("DELETE без JSON-тела (как адаптер инструментов) всё равно отдаёт причину в тело", () => {
    const req: AgentDeleteReasonRequest = {
      method: "DELETE",
      originalUrl: "/ai/v1/habits/h1?reason=не+нужна",
      query: { reason: "не нужна" }
    };
    applyAgentDeleteReason(req);
    expect(reasonReadFromBody(req.body)).toBe("не нужна");
  });

  it("пустая строка не затирает причину с другой стороны; вне DELETE /ai/v1 запрос не трогается", () => {
    const keep: AgentDeleteReasonRequest = {
      method: "DELETE",
      path: "/ai/v1/habits/h1",
      query: { reason: "" },
      body: { reason: "не нужна" }
    };
    applyAgentDeleteReason(keep);
    expect(reasonReadFromBody(keep.body)).toBe("не нужна");
    expect(reasonReadFromQuery(keep.query!)).toBe("не нужна");

    const other: AgentDeleteReasonRequest = {
      method: "DELETE",
      originalUrl: "/workspaces/w/documents/d",
      query: { reason: "чужое" },
      body: {}
    };
    applyAgentDeleteReason(other);
    expect(other.body).toEqual({});

    const post: AgentDeleteReasonRequest = {
      method: "POST",
      originalUrl: "/ai/v1/habits",
      query: { reason: "не сюда" },
      body: { name: "Зарядка" }
    };
    applyAgentDeleteReason(post);
    expect(post.body).toEqual({ name: "Зарядка" });
  });

  it("перехватчик копирует причину до того, как обработчик читает тело", () => {
    const req: AgentDeleteReasonRequest = {
      method: "DELETE",
      originalUrl: "/ai/v1/documents/d1",
      query: { reason: "до пайпа" },
      body: {}
    };
    let seen = "";
    new AgentDeleteReasonInterceptor().intercept(
      { getType: () => "http", switchToHttp: () => ({ getRequest: () => req }) } as never,
      { handle: () => { seen = reasonReadFromBody(req.body); return of(null); } }
    );
    expect(seen).toBe("до пайпа");
  });
});
