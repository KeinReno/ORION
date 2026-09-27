-- Server-side full-text search (ORION v0.7 — see docs/PLAN.md). Functional
-- GIN indexes, no denormalized tsvector column: the expression is small and
-- cheap enough to index directly, so there's no generated column to keep in
-- sync on every write. "russian" is Postgres's built-in text search config
-- (stemming — "задачи"/"задача" match the same lexeme), matching the
-- project's user-facing language (see CLAUDE.md "Стиль кода").
--
-- These tables are already under RLS (20260905121419_enable_rls) — that
-- policy applies to any SQL against them, raw or Prisma-built, so the
-- $queryRaw search path in TasksService/NotesService is exactly as isolated
-- as the ORM path.
--
-- array_to_string() is only STABLE (its output can vary with the array's
-- element order — no, in practice it doesn't, but Postgres can't prove
-- that), so Postgres refuses it directly inside a functional index, which
-- requires every function IMMUTABLE. This tiny SQL wrapper re-declares it
-- as IMMUTABLE — safe here because we only ever feed it a plain text[]
-- column with no session-dependent behaviour.
CREATE OR REPLACE FUNCTION "immutable_array_to_string"(text[], text)
  RETURNS text AS $$ SELECT array_to_string($1, $2) $$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

CREATE INDEX "notes_search_idx" ON "notes"
  USING GIN (to_tsvector('russian', "title" || ' ' || "body" || ' ' || immutable_array_to_string("tags", ' ')));

CREATE INDEX "tasks_search_idx" ON "tasks"
  USING GIN (to_tsvector('russian', "title" || ' ' || "description" || ' ' || coalesce("projectTag", '')));
