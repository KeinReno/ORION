#!/usr/bin/env node
/**
 * Local test owner: login `1` / password `1`, all modules on, team plugin on.
 * Uses DATABASE_URL (superuser) so workspace insert is not blocked by RLS.
 *
 *   pnpm db:seed-dev
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN = process.env.ORION_DEV_LOGIN ?? "1";
const PASSWORD = process.env.ORION_DEV_PASSWORD ?? "1";
const NAME = "Тестовый владелец";

function loadEnv(path) {
  if (!existsSync(path)) {
    throw new Error(`Нет ${path} — скопируйте apps/api/.env.example в .env`);
  }
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnv(join(ROOT, "apps", "api", ".env"));

const requireFromApi = createRequire(join(ROOT, "apps", "api", "package.json"));
const { PrismaClient } = requireFromApi("@prisma/client");
const argon2 = requireFromApi("argon2");

const prisma = new PrismaClient();

async function ensureWorkspace(userId) {
  const memberships = await prisma.workspaceMember.findMany({ where: { userId } });
  if (memberships.length === 0) {
    const workspace = await prisma.workspace.create({
      data: {
        name: `${NAME} — личное пространство`,
        icsToken: randomBytes(24).toString("base64url"),
        disabledModules: [],
        pluginOverrides: ["team"]
      }
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: "owner" }
    });
    return;
  }
  await prisma.workspaceMember.updateMany({
    where: { userId },
    data: { role: "owner" }
  });
  await prisma.workspace.updateMany({
    where: { id: { in: memberships.map((row) => row.workspaceId) } },
    data: { disabledModules: [], pluginOverrides: ["team"] }
  });
}

async function ensurePreference(userId) {
  await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, onboardingCompletedAt: new Date() },
    update: { onboardingCompletedAt: new Date() }
  });
}

async function main() {
  const passwordHash = await argon2.hash(PASSWORD);
  const existing = await prisma.user.findUnique({ where: { email: LOGIN } });
  const user =
    existing == null
      ? await prisma.user.create({
          data: {
            email: LOGIN,
            passwordHash,
            name: NAME,
            passwordStrength: 0,
            passwordChangedAt: new Date()
          }
        })
      : await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            name: NAME,
            passwordStrength: 0,
            passwordChangedAt: new Date()
          }
        });
  await ensureWorkspace(user.id);
  await ensurePreference(user.id);
  console.log(
    existing
      ? `Обновлён тестовый пользователь «${LOGIN}» (владелец, все модули и плагины).`
      : `Создан тестовый пользователь «${LOGIN}» (владелец, все модули и плагины).`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
