#!/usr/bin/env node
/**
 * G15 — генератор скелета модуля, подключаемого манифестом (docs/DEV_KIT.md).
 *
 *   pnpm create:module <id> --label "Русское название" [--dry-run]
 *
 * Создаёт каталоги модуля ровно в раскладке образца pet-care (docs/platform-api/MODULE_REGISTRY.md), затем пересобирает
 * реестр (`scripts/module-registry.mjs`) и документы (`scripts/module-docs.mjs`). Файлов ядра руками не правит:
 * меняются только каталоги модуля, генерируемые файлы реестра, области схемы между маркерами и копия миграции.
 *
 * Плагины этим скриптом не создаются: их регистрация (ORION_PLUGIN_IDS, PLUGIN_CATALOG, apps/web/plugins/index.ts,
 * SlotContracts) пока не data-driven — см. docs/DEV_KIT.md, раздел «Чего в комплекте нет».
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeRegistry } from "./module-registry.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_ID = 40;

const pascalOf = (id) => id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
const camelOf = (id) => {
  const p = pascalOf(id);
  return p[0].toLowerCase() + p.slice(1);
};

/** Имена, производные от id: `plants` -> Plants / plants / plants; `pet-care` -> PetCare / petCare / pet_care. */
export function namesOf(id) {
  return { id, pascal: pascalOf(id), camel: camelOf(id), snake: id.replace(/-/g, "_") };
}

function stringArrayConst(file, name) {
  if (!existsSync(file)) return [];
  const match = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(readFileSync(file, "utf8"));
  return match ? [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]) : [];
}

function dirNames(dir) {
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) : [];
}

/** Список причин, по которым `id` нельзя использовать (пустой — можно). */
export function idProblems(id, root = defaultRoot) {
  const problems = [];
  if (typeof id !== "string" || !ID_RE.test(id)) {
    problems.push(`id "${id}" должен быть в kebab-case: строчные латинские буквы и цифры через дефис, начинается с буквы`);
    return problems;
  }
  if (id.length > MAX_ID) problems.push(`id "${id}" длиннее ${MAX_ID} символов`);
  const shared = join(root, "packages/shared-types/src");
  if (stringArrayConst(join(shared, "modules.ts"), "CORE_MODULE_IDS").includes(id)) problems.push(`id "${id}" занят модулем ядра (CORE_MODULE_IDS)`);
  if (dirNames(join(root, "apps/api/src/modules-ext")).includes(id)) problems.push(`id "${id}" уже занят модулем, подключённым манифестом`);
  if (stringArrayConst(join(shared, "plugins.ts"), "CORE_PLUGIN_IDS").includes(id) || dirNames(join(root, "apps/web/plugins")).includes(id) ||
    dirNames(join(root, "apps/web/plugins-ext")).includes(id)) {
    problems.push(`id "${id}" занят плагином`);
  }
  if (dirNames(join(root, "apps/api/src")).includes(id)) problems.push(`id "${id}" совпадает с каталогом apps/api/src/${id}`);
  return problems;
}

/** Имя миграции ГГГГММДДЧЧММСС_имя; не раньше последней существующей, иначе Prisma применит её не в том порядке. */
export function migrationName(id, root = defaultRoot, now = new Date()) {
  const stamp = (date) => date.toISOString().replace(/\D/g, "").slice(0, 14);
  const existing = dirNames(join(root, "apps/api/prisma/migrations")).map((name) => /^(\d{14})_/.exec(name)?.[1]).filter(Boolean).sort();
  const latest = existing.at(-1);
  let when = stamp(now);
  if (latest && when <= latest) {
    const d = new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8), +latest.slice(8, 10), +latest.slice(10, 12), +latest.slice(12, 14) + 1));
    when = stamp(d);
  }
  return `${when}_${id.replace(/-/g, "_")}`;
}

/** Модели/таблицы, которые уже есть в schema.prisma, — новые не должны с ними совпасть. */
function schemaClashes(root, n) {
  const schemaPath = join(root, "apps/api/prisma/schema.prisma");
  if (!existsSync(schemaPath)) return [];
  const schema = readFileSync(schemaPath, "utf8");
  const problems = [];
  if (new RegExp(`^model\\s+${n.pascal}Item\\s*\\{`, "m").test(schema)) problems.push(`модель ${n.pascal}Item уже есть в schema.prisma`);
  if (schema.includes(`@@map("${n.snake}_items")`)) problems.push(`таблица ${n.snake}_items уже есть в schema.prisma`);
  return problems;
}

const fill = (template, values) => template.replace(/@@(\w+)@@/g, (_, key) => {
  if (!(key in values)) throw new Error(`шаблон: нет значения @@${key}@@`);
  return values[key];
});

// ---------- шаблоны ----------

const MANIFEST = (n, label, migration) => ({
  id: n.id,
  version: "1.0.0",
  catalog: {
    kind: "additional",
    required: false,
    label,
    summary: `${label}: записи пространства (заготовка — опишите модуль).`,
    owns: `Записи модуля «${label}» (заголовок и заметка).`,
    livesWithout: "Полностью самостоятелен: не требует и не использует другие предметные модули.",
    provides: [`Панель «${label}»`],
    optionalDependencies: [],
    disableBehavior: `Панель и API скрываются. Данные модуля «${label}» сохраняются и вернутся при включении.`,
    panelId: n.id,
    defaultEnabled: true
  },
  permissions: { primaryResource: "item" },
  api: { module: { file: `${n.id}.module`, export: `${n.pascal}Module` }, probePath: `/${n.id}/items` },
  web: { panel: { id: n.id, label, icon: "Box", group: "Работа", file: `${n.pascal}Panel`, export: `${n.pascal}Panel` } },
  prisma: {
    fragment: "prisma/models.prisma",
    workspaceBackRelations: [`${n.camel}Items ${n.pascal}Item[]`],
    migrations: [{ name: migration, file: "prisma/migration.sql" }]
  },
  data: {
    models: [
      {
        model: `${n.pascal}Item`,
        delegate: `${n.camel}Item`,
        snapshotKey: `${n.camel}Items`,
        snapshotPolicy: "included",
        reason: "Пользовательский контент модуля: входит в бэкап и восстановление.",
        sync: { syncClass: "lww-fields", stage: "later", note: "Поля записи — LWW по полю; офлайн-запись не включена." }
      }
    ]
  }
});

const MODULE_TS = `import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { WorkspacesModule } from "../../workspaces/workspaces.module";
import { @@P@@Controller } from "./@@ID@@.controller";
import { @@P@@Service } from "./@@ID@@.service";

/** @@LABEL@@ — модуль, подключённый манифестом (см. MODULE.md). Структура — как у pet-care/ и habits/. */
@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [@@P@@Controller],
  providers: [@@P@@Service]
})
export class @@P@@Module {}
`;

const CONTROLLER_TS = `import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  create@@P@@ItemInputSchema,
  update@@P@@ItemInputSchema,
  type Create@@P@@ItemInput,
  type @@P@@Item,
  type Update@@P@@ItemInput
} from "@orion/shared-types";
import type { RequestUser } from "../../auth/jwt.strategy";
import { CurrentUser } from "../../common/current-user.decorator";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireModule } from "../../modules/require-module";
import { @@P@@Service } from "./@@ID@@.service";

@RequireModule("@@ID@@")
@Controller("workspaces/:workspaceId/@@ID@@")
export class @@P@@Controller {
  constructor(private readonly service: @@P@@Service) {}

  @Get("items")
  list(@CurrentUser() user: RequestUser, @Param("workspaceId") workspaceId: string): Promise<@@P@@Item[]> {
    return this.service.list(user.userId, workspaceId);
  }

  @Post("items")
  create(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Body(new ZodValidationPipe(create@@P@@ItemInputSchema)) body: Create@@P@@ItemInput
  ): Promise<@@P@@Item> {
    return this.service.create(user.userId, workspaceId, body);
  }

  @Patch("items/:itemId")
  update(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(update@@P@@ItemInputSchema)) body: Update@@P@@ItemInput
  ): Promise<@@P@@Item> {
    return this.service.update(user.userId, workspaceId, itemId, body);
  }

  @Delete("items/:itemId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: RequestUser,
    @Param("workspaceId") workspaceId: string,
    @Param("itemId") itemId: string
  ): Promise<void> {
    await this.service.remove(user.userId, workspaceId, itemId);
  }
}
`;

const SERVICE_TS = `import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Create@@P@@ItemInput, @@P@@Item, Update@@P@@ItemInput } from "@orion/shared-types";
import { PrismaService } from "../../common/prisma.service";
import { WorkspacesService } from "../../workspaces/workspaces.service";

/**
 * @@LABEL@@. Инварианты обычного workspace-модуля (CLAUDE.md): членство проверяется первым,
 * всё идёт через \`withUser\` (RLS), наружу — DTO, собранный руками (\`toDto\`).
 */
@Injectable()
export class @@P@@Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService
  ) {}

  async list(userId: string, workspaceId: string): Promise<@@P@@Item[]> {
    const rows = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.@@C@@Item.findMany({ where: { workspaceId }, orderBy: [{ createdAt: "asc" }] });
    });
    return rows.map(toDto);
  }

  async create(userId: string, workspaceId: string, input: Create@@P@@ItemInput): Promise<@@P@@Item> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      return tx.@@C@@Item.create({ data: { workspaceId, title: input.title, note: input.note } });
    });
    return toDto(row);
  }

  async update(userId: string, workspaceId: string, itemId: string, input: Update@@P@@ItemInput): Promise<@@P@@Item> {
    const row = await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertItemTx(tx, workspaceId, itemId);
      return tx.@@C@@Item.update({
        where: { id: itemId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.note !== undefined ? { note: input.note } : {})
        }
      });
    });
    return toDto(row);
  }

  async remove(userId: string, workspaceId: string, itemId: string): Promise<void> {
    await this.prisma.withUser(userId, async (tx) => {
      await this.workspaces.assertMemberTx(tx, userId, workspaceId);
      await this.assertItemTx(tx, workspaceId, itemId);
      await tx.@@C@@Item.delete({ where: { id: itemId } });
    });
  }

  /** Запись должна принадлежать ЭТОМУ пространству: член двух пространств видит строки обоих (RLS этого не отличает). */
  private async assertItemTx(tx: Prisma.TransactionClient, workspaceId: string, itemId: string) {
    const item = await tx.@@C@@Item.findUnique({ where: { id: itemId } });
    if (!item || item.workspaceId !== workspaceId) throw new NotFoundException("Запись не найдена");
    return item;
  }
}

function toDto(row: {
  id: string;
  workspaceId: string;
  title: string;
  note: string;
  createdAt: Date;
  updatedAt: Date;
}): @@P@@Item {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
`;

const MODELS_PRISMA = `model @@P@@Item {
  id          String   @id @default(uuid())
  workspaceId String
  title       String
  note        String   @default("")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@map("@@S@@_items")
}
`;

const MIGRATION_SQL = `-- @@LABEL@@ (модуль по манифесту, G5/G10/G15): таблица и Row Level Security в одной миграции.
-- Копия этого файла в apps/api/prisma/migrations/ — генерируемая (scripts/module-registry.mjs), правьте здесь.
-- Структурный интеграционный тест api-rls требует ENABLE + FORCE RLS и политику для каждой таблицы с workspaceId.

-- CreateTable
CREATE TABLE "@@S@@_items" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "@@S@@_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "@@S@@_items_workspaceId_idx" ON "@@S@@_items"("workspaceId");

-- AddForeignKey
ALTER TABLE "@@S@@_items" ADD CONSTRAINT "@@S@@_items_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row Level Security
ALTER TABLE "@@S@@_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "@@S@@_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY @@S@@_items_isolation ON "@@S@@_items"
  USING (EXISTS (
    SELECT 1 FROM "workspace_members" wm
    WHERE wm."workspaceId" = "@@S@@_items"."workspaceId"
      AND wm."userId" = current_setting('app.current_user_id', true)
  ));
`;

const CONTRACT_TS = `import { z } from "zod";

/**
 * @@LABEL@@ — zod-контракт модуля (PLATFORM_AUDIT G15). В \`@orion/shared-types\` он попадает через автогенерируемый
 * \`modules-ext/registry.generated.ts\`. Схемы ответов — без \`.default(...)\`, входные — с ним.
 */

export const @@C@@ItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type @@P@@Item = z.infer<typeof @@C@@ItemSchema>;

export const create@@P@@ItemInputSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(200),
  note: z.string().max(4000).default("")
});
export type Create@@P@@ItemInput = z.infer<typeof create@@P@@ItemInputSchema>;

export const update@@P@@ItemInputSchema = z.object({
  title: z.string().trim().min(1, "Название обязательно").max(200).optional(),
  note: z.string().max(4000).optional()
});
export type Update@@P@@ItemInput = z.infer<typeof update@@P@@ItemInputSchema>;

/** Ответ 204 на удаление: клиентам модуля нужна схема «без тела», а \`z\` они из контракта не берут. */
export const @@C@@NoContentSchema = z.void();
`;

const HOOKS_TS = `"use client";

import { createModuleClient, workspaceModuleBase } from "@orion/core";
import { useCore } from "@orion/core-react";
import {
  @@C@@ItemSchema,
  @@C@@NoContentSchema,
  type Create@@P@@ItemInput,
  type @@P@@Item,
  type Update@@P@@ItemInput
} from "@orion/shared-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Хуки модуля «@@LABEL@@». Ходят через \`createModuleClient\` поверх \`ApiClient.extensionRequest\` (G5/G24), поэтому модуль не правит
 * \`@orion/core\` / \`@orion/core-react\`. Ключи кэша — \`["@@ID@@", ...]\`.
 */
const client = (api: Parameters<typeof createModuleClient>[0], workspaceId: string | undefined) =>
  createModuleClient(api, workspaceModuleBase(workspaceId as string, "@@ID@@"));

export function use@@P@@Items(workspaceId: string | undefined) {
  const { api } = useCore();
  return useQuery<@@P@@Item[]>({
    queryKey: ["@@ID@@", workspaceId, "items"],
    queryFn: () => client(api, workspaceId).get("/items", @@C@@ItemSchema.array()),
    enabled: Boolean(workspaceId)
  });
}

export function useCreate@@P@@Item(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Create@@P@@ItemInput) => client(api, workspaceId).post("/items", input, @@C@@ItemSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["@@ID@@", workspaceId, "items"] })
  });
}

export function useUpdate@@P@@Item(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: Update@@P@@ItemInput }) =>
      client(api, workspaceId).patch(\`/items/\${itemId}\`, input, @@C@@ItemSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["@@ID@@", workspaceId, "items"] })
  });
}

export function useDelete@@P@@Item(workspaceId: string | undefined) {
  const { api } = useCore();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      client(api, workspaceId).delete(\`/items/\${itemId}\`, @@C@@NoContentSchema),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["@@ID@@", workspaceId, "items"] })
  });
}
`;

const PANEL_TSX = `"use client";

import { Button, EmptyState, Input, PanelBody, PanelHeader, PanelShell, Skeleton, useToast } from "@orion/ui";
import { Box, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { describeError } from "../../lib/error-message";
import { useActiveWorkspace } from "../../lib/use-active-workspace";
import { useCreate@@P@@Item, useDelete@@P@@Item, use@@P@@Items } from "./use-@@ID@@";

/**
 * @@LABEL@@: список записей с добавлением и удалением (заготовка из \`pnpm create:module\`).
 * Подключается генерируемым \`modules-ext/panels.generated.ts\`, а не строкой в \`panel-registry.ts\`.
 */
export function @@P@@Panel(): React.ReactElement {
  const { workspace, isLoading: workspaceLoading } = useActiveWorkspace();
  const workspaceId = workspace?.id;
  const { toast } = useToast();
  const items = use@@P@@Items(workspaceId);
  const createItem = useCreate@@P@@Item(workspaceId);
  const deleteItem = useDelete@@P@@Item(workspaceId);
  const [title, setTitle] = useState("");

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (title.trim() === "") return;
    try {
      await createItem.mutateAsync({ title: title.trim(), note: "" });
      setTitle("");
    } catch (error) {
      toast({ title: "Не удалось добавить запись", description: describeError(error), tone: "danger" });
    }
  }

  async function remove(itemId: string): Promise<void> {
    try {
      await deleteItem.mutateAsync(itemId);
    } catch (error) {
      toast({ title: "Не удалось удалить запись", description: describeError(error), tone: "danger" });
    }
  }

  return (
    <PanelShell>
      <PanelHeader icon={Box} title=@@LABEL_JSX@@ subtitle="Записи пространства" />
      <PanelBody measure="wide">
        {workspaceId === undefined ? (
          workspaceLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <EmptyState icon={Box} title="Нет рабочего пространства" description="Записи живут внутри пространства — создайте его или войдите заново." />
          )
        ) : (
          <div className="space-y-4">
            <form onSubmit={(event) => void add(event)} className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Новая запись"
                maxLength={200}
                aria-label="Название новой записи"
              />
              <Button type="submit" size="sm" disabled={createItem.isPending || title.trim() === ""}>
                <Plus className="h-4 w-4" /> Добавить
              </Button>
            </form>
            {items.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : items.isError ? (
              <EmptyState
                icon={Box}
                tone="danger"
                title="Не удалось загрузить записи"
                description={describeError(items.error)}
                action={
                  <Button size="sm" variant="outline" onClick={() => void items.refetch()}>
                    Повторить
                  </Button>
                }
              />
            ) : (items.data ?? []).length === 0 ? (
              <EmptyState icon={Box} title="Записей пока нет" description="Добавьте первую запись выше." />
            ) : (
              <ul className="space-y-2" aria-label="Записи">
                {(items.data ?? []).map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3" data-testid={\`@@ID@@-item-\${item.id}\`}>
                    <span className="min-w-0 truncate font-medium">{item.title}</span>
                    <Button size="sm" variant="subtle" onClick={() => void remove(item.id)} aria-label={\`Удалить \${item.title}\`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </PanelBody>
    </PanelShell>
  );
}
`;

const INTEGRATION_TEST_TS = `import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MODULE_CATALOG, ORION_MODULE_IDS, orionModuleIdSchema } from "@orion/shared-types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../src/app.module";
import { PrismaService } from "../../../src/common/prisma.service";
import { configureApp } from "../../../src/configure-app";
import { SNAPSHOT_MODEL_REGISTRY } from "../../../src/sync/snapshot-registry";
import { SYNC_CLASSIFICATION } from "../../../src/sync/sync-classification";

/**
 * @@LABEL@@ (заготовка из \`pnpm create:module\`): регистрация через сгенерированные реестры, CRUD, изоляция второго
 * пользователя (API и RLS), 409 при выключенном модуле и сохранность данных при выключении. Дополняйте своими сценариями.
 */
describe("@@LABEL@@ module connected by manifest", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const runId = \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;
  const emailPrefix = \`@@ID@@-\${runId}\`;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    baseUrl = \`http://127.0.0.1:\${(app.getHttpServer().address() as { port: number }).port}\`;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.asSystem(async (tx) => {
        const users = await tx.user.findMany({ where: { email: { startsWith: emailPrefix } }, select: { id: true } });
        if (users.length === 0) return;
        const userIds = users.map((u) => u.id);
        const memberships = await tx.workspaceMember.findMany({ where: { userId: { in: userIds } }, select: { workspaceId: true } });
        const workspaceIds = [...new Set(memberships.map((m) => m.workspaceId))];
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
        const leftovers = await tx.workspace.count({ where: { id: { in: workspaceIds } } });
        if (leftovers > 0) throw new Error(\`Cleanup left \${leftovers} test workspace(s) behind\`);
        // Каскад от пространства обязан унести и таблицу модуля.
        const orphans = await tx.@@C@@Item.count({ where: { workspaceId: { in: workspaceIds } } });
        if (orphans > 0) throw new Error(\`Cleanup left \${orphans} item(s) behind\`);
      });
    }
    await app?.close();
  });

  async function request<T = any>(path: string, options: { method: string; token?: string; body?: unknown }) {
    const response = await fetch(\`\${baseUrl}\${path}\`, {
      method: options.method,
      headers: { "Content-Type": "application/json", ...(options.token ? { Authorization: \`Bearer \${options.token}\` } : {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const text = await response.text();
    return { status: response.status, data: (text ? JSON.parse(text) : null) as T };
  }

  let counter = 0;
  async function setup() {
    const response = await request<{ accessToken: string; user: { id: string } }>("/auth/register", {
      method: "POST",
      body: { email: \`\${emailPrefix}-\${counter++}@example.test\`, password: "integration-password-123", name: "Участник" }
    });
    const token = response.data.accessToken;
    const workspaces = await request<Array<{ id: string }>>("/workspaces/me", { method: "GET", token });
    const ws = workspaces.data[0]!.id;
    return {
      token,
      ws,
      userId: response.data.user.id,
      call: (method: string, path: string, body?: unknown) => request(\`/workspaces/\${ws}/@@ID@@\${path}\`, { method, token, body }),
      setModule: (enabled: boolean) => request(\`/workspaces/\${ws}/modules/@@ID@@\`, { method: "PATCH", token, body: { enabled } })
    };
  }

  it("is registered through the generated registries, not by hand", () => {
    expect((ORION_MODULE_IDS as readonly string[]).includes("@@ID@@")).toBe(true);
    expect(orionModuleIdSchema.safeParse("@@ID@@").success).toBe(true);
    expect(orionModuleIdSchema.safeParse("not-a-module").success).toBe(false);
    expect(MODULE_CATALOG.find((item) => item.id === "@@ID@@")?.panelId).toBe("@@ID@@");
    expect(SNAPSHOT_MODEL_REGISTRY.find((item) => item.model === "@@P@@Item")?.policy).toBe("included");
    expect(SYNC_CLASSIFICATION["@@P@@Item"]).toBeDefined();
  });

  it("creates, lists, updates and deletes items", async () => {
    const { call } = await setup();
    expect((await call("GET", "/items")).data).toEqual([]);

    const created = await call("POST", "/items", { title: "  Первая " });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ title: "Первая", note: "" });
    expect((await call("POST", "/items", { title: "   " })).status).toBe(400);

    const itemId = created.data.id as string;
    const updated = await call("PATCH", \`/items/\${itemId}\`, { note: "Заметка" });
    expect(updated.data).toMatchObject({ title: "Первая", note: "Заметка" });
    expect((await call("GET", "/items")).data).toHaveLength(1);

    expect((await call("DELETE", \`/items/\${itemId}\`)).status).toBe(204);
    expect((await call("DELETE", \`/items/\${itemId}\`)).status).toBe(404);
    expect((await call("GET", "/items")).data).toEqual([]);
  });

  it("isolates a second user: API membership check, per-workspace ownership and database RLS", async () => {
    const alice = await setup();
    const bob = await setup();
    const item = await alice.call("POST", "/items", { title: "Секретная" });

    // Чужое пространство: нет членства -> 403.
    expect((await request(\`/workspaces/\${alice.ws}/@@ID@@/items\`, { method: "GET", token: bob.token })).status).toBe(403);
    // Своё пространство, чужая запись -> 404, а не данные.
    expect((await bob.call("PATCH", \`/items/\${item.data.id}\`, { title: "Взлом" })).status).toBe(404);
    expect((await bob.call("DELETE", \`/items/\${item.data.id}\`)).status).toBe(404);
    expect((await bob.call("GET", "/items")).data).toEqual([]);

    // RLS отдельно от кода: прямой запрос от имени Боба не видит строк Алисы, от имени Алисы — видит.
    const hidden = await prisma.withUser(bob.userId, (tx) => tx.@@C@@Item.findMany({ where: { workspaceId: alice.ws } }));
    expect(hidden).toEqual([]);
    const visible = await prisma.withUser(alice.userId, (tx) => tx.@@C@@Item.findMany({ where: { workspaceId: alice.ws } }));
    expect(visible).toHaveLength(1);
  });

  it("answers 409 while the module is disabled, keeps the data, and works again after enabling", async () => {
    const { call, setModule } = await setup();
    await call("POST", "/items", { title: "Останется" });

    expect((await setModule(false)).status).toBe(200);
    for (const [method, path, body] of [
      ["GET", "/items", undefined],
      ["POST", "/items", { title: "Нельзя" }]
    ] as const) {
      expect((await call(method, path, body)).status, \`\${method} \${path}\`).toBe(409);
    }

    expect((await setModule(true)).status).toBe(200);
    expect((await call("GET", "/items")).data.map((i: { title: string }) => i.title)).toEqual(["Останется"]);
  });
});
`;

const MODULE_MD = `# @@LABEL@@ — модуль, подключённый манифестом

Заготовка, созданная \`pnpm create:module @@ID@@\` (подробности — [\`docs/DEV_KIT.md\`](../../../../../docs/DEV_KIT.md) и
[\`docs/platform-api/MODULE_REGISTRY.md\`](../../../../../docs/platform-api/MODULE_REGISTRY.md)). Образец полного модуля — \`pet-care/\`.

## Что лежит в каталогах модуля

| Файл | Зачем |
|---|---|
| \`module.manifest.json\` | единственная точка обнаружения: запись каталога, ресурс разрешений, Nest-модуль, панель, Prisma, политика снапшота и синхронизации |
| \`@@ID@@.module.ts\`, \`@@ID@@.controller.ts\`, \`@@ID@@.service.ts\` | Nest-часть: \`@RequireModule("@@ID@@")\`, zod-валидация, \`assertMemberTx\` и \`withUser\`, DTO руками (\`toDto\`) |
| \`prisma/models.prisma\` | модель \`@@P@@Item\` (\`workspaceId\`, \`@@map\`, связь с \`Workspace\`); попадает в \`schema.prisma\` генератором |
| \`prisma/migration.sql\` | таблица + \`ENABLE\`/\`FORCE ROW LEVEL SECURITY\` + \`CREATE POLICY\`; копия в \`apps/api/prisma/migrations/\` генерируется |
| \`apps/web/modules-ext/@@ID@@/\` | панель \`@@P@@Panel.tsx\` и хуки \`use-@@ID@@.ts\` |
| \`packages/shared-types/src/modules-ext/@@ID@@/index.ts\` | zod-контракты (ответы без \`.default\`) |
| \`apps/api/test/modules-ext/@@ID@@/@@ID@@.integration.test.ts\` | интеграционный тест: регистрация, CRUD, изоляция, 409 при выключении |

## Что сделать дальше

1. Замените заготовку \`@@P@@Item\` своей предметной моделью: правьте \`prisma/models.prisma\`, \`prisma/migration.sql\` (пока миграция
   не применена и не влита), \`data.models\` в манифесте, контракт, сервис, панель и тест.
2. Заполните \`catalog.summary/owns/livesWithout/provides\` в манифесте реальными формулировками.
3. \`pnpm module-registry\` → \`pnpm db:generate\` → \`pnpm --filter @orion/api prisma:migrate:deploy\` (на своей БД, не на общей).
4. Проверки приёмки перечислены в \`docs/DEV_KIT.md\`.
`;

/** Полный набор файлов скелета: [{ path, content }] относительно корня репозитория. */
export function scaffoldFiles(id, label, root = defaultRoot, now = new Date()) {
  const n = namesOf(id);
  const migration = migrationName(id, root, now);
  const values = {
    ID: id,
    P: n.pascal,
    C: n.camel,
    S: n.snake,
    LABEL: label,
    LABEL_JSX: JSON.stringify(label)
  };
  const api = `apps/api/src/modules-ext/${id}`;
  const web = `apps/web/modules-ext/${id}`;
  return {
    migration,
    files: [
      { path: `${api}/module.manifest.json`, content: JSON.stringify(MANIFEST(n, label, migration), null, 2) + "\n" },
      { path: `${api}/${id}.module.ts`, content: fill(MODULE_TS, values) },
      { path: `${api}/${id}.controller.ts`, content: fill(CONTROLLER_TS, values) },
      { path: `${api}/${id}.service.ts`, content: fill(SERVICE_TS, values) },
      { path: `${api}/prisma/models.prisma`, content: fill(MODELS_PRISMA, values) },
      { path: `${api}/prisma/migration.sql`, content: fill(MIGRATION_SQL, values) },
      { path: `${api}/MODULE.md`, content: fill(MODULE_MD, values) },
      { path: `${web}/${n.pascal}Panel.tsx`, content: fill(PANEL_TSX, values) },
      { path: `${web}/use-${id}.ts`, content: fill(HOOKS_TS, values) },
      { path: `packages/shared-types/src/modules-ext/${id}/index.ts`, content: fill(CONTRACT_TS, values) },
      { path: `apps/api/test/modules-ext/${id}/${id}.integration.test.ts`, content: fill(INTEGRATION_TEST_TS, values) }
    ]
  };
}

/**
 * Проверяет вход и создаёт файлы (если не `dryRun`). Бросает Error с понятным текстом; ничего не пишет,
 * пока проверки не пройдены. Реестр и документы запускает вызывающий (CLI) — здесь только скелет.
 */
export function createModule({ id, label, root = defaultRoot, dryRun = false, now = new Date() }) {
  if (typeof label !== "string" || label.trim() === "") throw new Error('Укажите русское название: --label "Название"');
  const trimmed = label.trim();
  if (/[\r\n]/.test(trimmed) || trimmed.length > 60) throw new Error("--label: одна строка не длиннее 60 символов");
  const problems = [...idProblems(id, root)];
  if (problems.length === 0) {
    problems.push(...schemaClashes(root, namesOf(id)));
    for (const dir of [`apps/api/src/modules-ext/${id}`, `apps/web/modules-ext/${id}`, `packages/shared-types/src/modules-ext/${id}`, `apps/api/test/modules-ext/${id}`]) {
      if (existsSync(join(root, dir))) problems.push(`${dir} уже существует — скрипт ничего не перезаписывает`);
    }
  }
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const { files, migration } = scaffoldFiles(id, trimmed, root, now);
  const extra = [`apps/api/src/modules-ext/${id}/AI_CONTEXT.md (создаёт module-docs)`, `apps/api/prisma/migrations/${migration}/migration.sql (копия, создаёт module-registry)`];
  if (!dryRun) {
    for (const file of files) {
      const full = join(root, file.path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, file.content);
    }
  }
  return { files: files.map((file) => file.path), generated: extra, migration };
}

function parseArgs(argv) {
  const args = { dryRun: false, id: undefined, label: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--label") args.label = argv[++i];
    else if (arg.startsWith("--label=")) args.label = arg.slice("--label=".length);
    else if (arg.startsWith("--")) throw new Error(`Неизвестный параметр ${arg}`);
    else if (args.id === undefined) args.id = arg;
    else throw new Error(`Лишний аргумент "${arg}"`);
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.id) throw new Error('Использование: pnpm create:module <id> --label "Русское название" [--dry-run]');
    const result = createModule({ id: args.id, label: args.label, dryRun: args.dryRun });
    if (args.dryRun) {
      console.log(`Будет создано (--dry-run, ничего не записано):\n${[...result.files, ...result.generated].map((file) => `  ${file}`).join("\n")}`);
      console.log("Затем: scripts/module-registry.mjs (генерируемые файлы, область схемы), scripts/module-docs.mjs (AI_CONTEXT.md и блок MODULE.md) и scripts/platform-map.mjs (карта возможностей).");
    } else {
      writeRegistry(defaultRoot);
      execFileSync(process.execPath, [join(defaultRoot, "scripts/module-docs.mjs")], { cwd: defaultRoot, stdio: "inherit" });
      execFileSync(process.execPath, [join(defaultRoot, "scripts/platform-map.mjs")], { cwd: defaultRoot, stdio: "inherit" });
      console.log(`Модуль ${args.id} создан:\n${[...result.files, ...result.generated].map((file) => `  ${file}`).join("\n")}`);
      console.log("\nДальше: pnpm db:generate, правка заготовки под предметную область, проверки приёмки — docs/DEV_KIT.md.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
