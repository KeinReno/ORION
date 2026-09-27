#!/usr/bin/env node
/**
 * Fills (or rebuilds) workspace «Демонстрационный 1» — live studio data for
 * ООО «Северный контур»: every domain module gets a coherent set of records.
 *
 *   pnpm demo:seed
 *
 * Uses DATABASE_URL (superuser) so workspace insert is not blocked by RLS.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = join(ROOT, "scripts", "demo-content");
const WORKSPACE_NAME = "Демонстрационный 1";
const ISOLATED = process.argv.includes("--isolated");
const PASSWORD = process.env.ORION_DEMO_PASSWORD ?? "1111";
const TZ = "Europe/Moscow";

const PEOPLE = [
  { email: "volkova@severny-kontur.ru", name: "Мария Волкова", role: "owner" },
  { email: "orlov@severny-kontur.ru", name: "Павел Орлов", role: "lead" },
  { email: "belova@severny-kontur.ru", name: "Анна Белова", role: "member" }
];

function loadEnv(path) {
  if (!existsSync(path)) {
    if (process.env.DATABASE_URL) return;
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

const STORAGE_ROOT = resolve(
  join(ROOT, "apps", "api"),
  process.env.STORAGE_DIR?.trim() || ".data/documents"
);

function rub(amount) {
  return Math.round(amount * 100);
}

function atLocal(daysFromToday, hours, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function dayUtc(daysFromToday) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function monthStart(offsetMonths = 0) {
  const date = new Date();
  return new Date(Date.UTC(date.getFullYear(), date.getMonth() + offsetMonths, 1));
}

function mimeFor(name) {
  const ext = extname(name).toLowerCase();
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkFiles(full, acc);
    else acc.push(full);
  }
  return acc;
}

async function ensureUser(spec, passwordHash) {
  const existing = await prisma.user.findUnique({ where: { email: spec.email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, name: spec.name, passwordStrength: 2, passwordChangedAt: new Date() }
    });
  }
  return prisma.user.create({
    data: {
      email: spec.email,
      passwordHash,
      name: spec.name,
      passwordStrength: 2,
      passwordChangedAt: new Date()
    }
  });
}

async function ensurePreference(userId) {
  await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      onboardingCompletedAt: new Date(),
      timeZone: TZ,
      weekStartsOn: 1,
      dashboardWidgets: ["focus", "calendar", "tasks", "finance", "notes", "projects"]
    },
    update: { onboardingCompletedAt: new Date(), timeZone: TZ }
  });
}

async function rebuildNoteLinks(workspaceId) {
  const notes = await prisma.note.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, title: true, body: true }
  });
  const idByTitle = new Map(notes.map((note) => [note.title.toLowerCase(), note.id]));
  await prisma.noteLink.deleteMany({ where: { workspaceId } });
  const rows = [];
  for (const note of notes) {
    const seen = new Set();
    for (const match of note.body.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const title = match[1].trim();
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      rows.push({
        workspaceId,
        sourceNoteId: note.id,
        targetNoteId: idByTitle.get(key) && idByTitle.get(key) !== note.id ? idByTitle.get(key) : null,
        targetTitle: title
      });
    }
  }
  if (rows.length) await prisma.noteLink.createMany({ data: rows });
}

async function putDocument(workspaceId, parentId, relativePath, absPath, projectId) {
  const parts = relativePath.split(/[/\\]/).filter(Boolean);
  const fileName = parts.pop();
  let currentParent = parentId;
  const segments = [];
  for (const folderName of parts) {
    segments.push(folderName);
    const existing = await prisma.document.findFirst({
      where: { workspaceId, parentId: currentParent, kind: "folder", name: folderName, deletedAt: null }
    });
    if (existing) {
      currentParent = existing.id;
      continue;
    }
    mkdirSync(join(STORAGE_ROOT, workspaceId, ...segments), { recursive: true });
    const folder = await prisma.document.create({
      data: { workspaceId, parentId: currentParent, kind: "folder", name: folderName, projectId }
    });
    currentParent = folder.id;
  }
  const buf = readFileSync(absPath);
  const checksum = createHash("sha256").update(buf).digest("hex");
  const dest = join(STORAGE_ROOT, workspaceId, ...segments, fileName);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  const text = buf.toString("utf8");
  return prisma.document.create({
    data: {
      workspaceId,
      parentId: currentParent,
      projectId,
      kind: "file",
      name: fileName,
      mimeType: mimeFor(fileName),
      sizeBytes: buf.length,
      checksum,
      extractedText: text
    }
  });
}

async function seedDocuments(workspaceId, projects) {
  const projectByHint = [
    { hint: "Северный ветер", projectId: projects.veter.id },
    { hint: "Балтийский причал", projectId: projects.prichal.id },
    { hint: "Ласточка", projectId: projects.lastocka.id },
    { hint: "Производство", projectId: projects.showroom.id },
    { hint: "Внутреннее", projectId: projects.studio.id },
    { hint: "Финансы", projectId: projects.studio.id }
  ];
  const files = walkFiles(CONTENT_DIR);
  const created = {};
  for (const abs of files) {
    const rel = relative(CONTENT_DIR, abs);
    const hint = projectByHint.find((row) => rel.includes(row.hint));
    const doc = await putDocument(workspaceId, null, rel, abs, hint?.projectId ?? null);
    created[rel.replace(/\\/g, "/")] = doc;
  }
  return created;
}

async function main() {
  if (process.argv.includes("--if-missing")) {
    const found = await prisma.workspace.findFirst({ where: { name: WORKSPACE_NAME } });
    if (found) {
      console.log(`Пространство «${WORKSPACE_NAME}» уже есть — пропускаю наполнение.`);
      return;
    }
  }

  if (ISOLATED) {
    const leftover = await prisma.workspace.findMany({ select: { id: true } });
    for (const row of leftover) {
      await prisma.workspace.delete({ where: { id: row.id } });
      rmSync(join(STORAGE_ROOT, row.id), { recursive: true, force: true });
    }
    await prisma.user.deleteMany();
    mkdirSync(STORAGE_ROOT, { recursive: true });
  }

  const passwordHash = await argon2.hash(PASSWORD);
  const users = {};
  for (const person of PEOPLE) {
    users[person.role] = await ensureUser(person, passwordHash);
    await ensurePreference(users[person.role].id);
  }

  const existingDev = ISOLATED ? null : await prisma.user.findUnique({ where: { email: "1" } });
  if (existingDev) await ensurePreference(existingDev.id);

  if (!ISOLATED) {
    const previous = await prisma.workspace.findMany({ where: { name: WORKSPACE_NAME } });
    for (const row of previous) {
      await prisma.workspace.delete({ where: { id: row.id } });
      rmSync(join(STORAGE_ROOT, row.id), { recursive: true, force: true });
    }
  }

  const workspace = await prisma.workspace.create({
    data: {
      name: WORKSPACE_NAME,
      icsToken: randomBytes(24).toString("base64url"),
      disabledModules: [],
      pluginOverrides: ["team"]
    }
  });
  const ws = workspace.id;

  const ownerMember = await prisma.workspaceMember.create({
    data: { workspaceId: ws, userId: users.owner.id, role: "owner" }
  });
  const leadMember = await prisma.workspaceMember.create({
    data: { workspaceId: ws, userId: users.lead.id, role: "lead" }
  });
  const memberMember = await prisma.workspaceMember.create({
    data: { workspaceId: ws, userId: users.member.id, role: "member" }
  });
  if (existingDev && existingDev.id !== users.owner.id) {
    await prisma.workspaceMember.create({
      data: { workspaceId: ws, userId: existingDev.id, role: "owner" }
    });
  }

  const studio = await prisma.project.create({
    data: {
      workspaceId: ws,
      name: "Студия",
      color: "slate",
      description: "Внутренние дела ООО «Северный контур»: регламент, закупки, шоурум на Карповке.",
      contextNote: "На этой неделе: комплектация шоурума на Васильевском и пятничный статус «Северному ветру».",
      hourlyRate: rub(3200),
      budgetAmount: rub(240000),
      startAt: atLocal(-90, 10, 0)
    }
  });
  const veter = await prisma.project.create({
    data: {
      workspaceId: ws,
      name: "Северный ветер",
      color: "indigo",
      description: "Полное digital-сопровождение сети кафе: сайт, реклама, сезонные носители.",
      contextNote: "Ирина ждёт осенние пакеты и держит навигацию Литейного в черновике.",
      hourlyRate: rub(3500),
      budgetAmount: rub(2160000),
      startAt: atLocal(-200, 11, 0),
      dueAt: atLocal(103, 18, 0)
    }
  });
  const prichal = await prisma.project.create({
    data: {
      workspaceId: ws,
      name: "Балтийский причал",
      color: "teal",
      description: "Корпоративный сайт логистического оператора: концепция, дизайн, запуск.",
      contextNote: "Концепция на экране 3 октября в офисе заказчика. Английская версия — ноябрь.",
      hourlyRate: rub(4000),
      budgetAmount: rub(320000),
      startAt: atLocal(-18, 10, 0),
      dueAt: atLocal(39, 18, 0)
    }
  });
  const showroom = await prisma.project.create({
    data: {
      workspaceId: ws,
      name: "Шоурум на Васильевском",
      color: "amber",
      description: "Оформление собственного шоурума: стойка, свет, навигация, текстиль.",
      contextNote: "Блэкаута на складе не хватает 6 метров — закупка до конца недели.",
      hourlyRate: rub(2800),
      budgetAmount: rub(410000),
      startAt: atLocal(-30, 10, 0),
      dueAt: atLocal(19, 16, 0)
    }
  });
  const lastocka = await prisma.project.create({
    data: {
      workspaceId: ws,
      name: "Ласточка",
      color: "rose",
      description: "Айдентика кондитерской. Сдано в августе, в архиве носители и легенда бренда.",
      contextNote: "Повторный тираж пакетов не раньше ноября.",
      hourlyRate: rub(3000),
      budgetAmount: rub(180000),
      startAt: atLocal(-140, 10, 0),
      dueAt: atLocal(-30, 18, 0),
      archivedAt: atLocal(-20, 12, 0),
      status: "completed"
    }
  });
  const projects = { studio, veter, prichal, showroom, lastocka };

  const msConcept = await prisma.milestone.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Замер и концепция",
      note: "План расстановки и стойка согласованы.",
      status: "done",
      startAt: atLocal(-28, 10, 0),
      dueAt: atLocal(-10, 18, 0),
      estimatedMinutes: 16 * 60,
      order: 0
    }
  });
  const msBuild = await prisma.milestone.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Производство",
      note: "Стойка на фабрике, табличка в гравировке.",
      status: "in_progress",
      startAt: atLocal(-9, 10, 0),
      dueAt: atLocal(12, 18, 0),
      estimatedMinutes: 40 * 60,
      order: 1
    }
  });
  const msMount = await prisma.milestone.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Монтаж",
      note: "Два дня на объекте, приёмка 8 октября в 16:00.",
      status: "planned",
      startAt: atLocal(18, 9, 0),
      dueAt: atLocal(19, 16, 0),
      estimatedMinutes: 16 * 60,
      order: 2
    }
  });
  await prisma.milestoneDependency.createMany({
    data: [
      { workspaceId: ws, milestoneId: msBuild.id, dependsOnMilestoneId: msConcept.id },
      { workspaceId: ws, milestoneId: msMount.id, dependsOnMilestoneId: msBuild.id }
    ]
  });

  const tStatus = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      title: "Пятничный статус «Северному ветру»",
      description: "Короткое письмо Ирине: что вышло в рекламе, что в печати, что ждём по Литейному.",
      status: "todo",
      priority: "high",
      projectTag: "ВЕТЕР",
      sortOrder: 0,
      dueAt: atLocal(0, 16, 0),
      estimatedMinutes: 40,
      assigneeId: memberMember.id,
      startAt: atLocal(0, 14, 0)
    }
  });
  const tBags = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      title: "Тираж пакетов крафт 500 шт",
      description: "Макет утверждён. Печать в «Невской типографии», доставка на Петроградскую.",
      status: "in_progress",
      priority: "high",
      projectTag: "ВЕТЕР",
      sortOrder: 1,
      dueAt: atLocal(4, 12, 0),
      estimatedMinutes: 180,
      assigneeId: memberMember.id,
      startAt: atLocal(-3, 11, 0)
    }
  });
  const tAds = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      title: "Кампания «Осеннее меню»",
      description: "Директ + VK. Бюджет медиа — у клиента. Нам — объявления и посадочная.",
      status: "in_progress",
      priority: "normal",
      projectTag: "ВЕТЕР",
      sortOrder: 2,
      dueAt: atLocal(2, 18, 0),
      estimatedMinutes: 240,
      assigneeId: leadMember.id,
      startAt: atLocal(-5, 10, 0)
    }
  });
  const tSite = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: prichal.id,
      title: "Концепция сайта «Балтийский причал»",
      description: "Пять разделов, синий/песочный, без стоковых контейнеров. Показ 3 октября.",
      status: "in_progress",
      priority: "high",
      projectTag: "ПРИЧАЛ",
      sortOrder: 0,
      dueAt: atLocal(14, 15, 0),
      estimatedMinutes: 20 * 60,
      assigneeId: leadMember.id,
      startAt: atLocal(-10, 10, 0)
    }
  });
  const tPhoto = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: prichal.id,
      title: "Ретушь съёмки терминала",
      description: "Исходники от 8 сентября. Убрать технику подрядчика с заднего плана.",
      status: "todo",
      priority: "normal",
      projectTag: "ПРИЧАЛ",
      sortOrder: 1,
      dueAt: atLocal(3, 18, 0),
      estimatedMinutes: 300,
      assigneeId: leadMember.id,
      startAt: atLocal(1, 10, 0)
    }
  });
  const tStand = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Контроль стойки на фабрике",
      description: "Шпон дуба, столешница массив. Сверить с спецификацией до отгрузки.",
      status: "in_progress",
      priority: "high",
      projectTag: "ШОУРУМ",
      sortOrder: 0,
      dueAt: atLocal(5, 17, 0),
      estimatedMinutes: 120,
      assigneeId: memberMember.id,
      milestoneId: msBuild.id,
      startAt: atLocal(-2, 11, 0)
    }
  });
  const tTextile = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Дозакупка блэкаута 6 м",
      description: "На складе 12 м, по спецификации 18. Ткань та же партия, склад на Обводном.",
      status: "todo",
      priority: "high",
      projectTag: "ШОУРУМ",
      sortOrder: 1,
      dueAt: atLocal(1, 15, 0),
      estimatedMinutes: 90,
      assigneeId: memberMember.id,
      milestoneId: msBuild.id,
      startAt: atLocal(0, 11, 0)
    }
  });
  const tMount = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Монтаж шоурума 7–8 октября",
      description: "Бригада + Павел на приёмке 8 октября в 16:00.",
      status: "todo",
      priority: "normal",
      projectTag: "ШОУРУМ",
      sortOrder: 2,
      dueAt: atLocal(19, 16, 0),
      estimatedMinutes: 16 * 60,
      assigneeId: ownerMember.id,
      milestoneId: msMount.id,
      startAt: atLocal(18, 9, 0)
    }
  });
  const tOverdue = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: studio.id,
      title: "Продлить договор аренды на Карповке",
      description: "Управляющая ждёт письмо до конца прошлой недели.",
      status: "todo",
      priority: "high",
      projectTag: "СТУДИЯ",
      sortOrder: 0,
      dueAt: atLocal(-2, 12, 0),
      estimatedMinutes: 45,
      assigneeId: ownerMember.id
    }
  });
  const tDone = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: lastocka.id,
      title: "Сдать исходники «Ласточки»",
      description: "Пакет, лента, ценники, гайд. Акт подписан.",
      status: "done",
      priority: "normal",
      projectTag: "ЛАСТОЧКА",
      sortOrder: 0,
      dueAt: atLocal(-32, 18, 0),
      completedAt: atLocal(-30, 16, 30),
      estimatedMinutes: 120,
      assigneeId: leadMember.id
    }
  });
  const tBacklog = await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: studio.id,
      title: "Страница вакансии продюсера на сайт студии",
      description: "Не раньше ноября, после запуска шоурума.",
      status: "backlog",
      priority: "low",
      projectTag: "СТУДИЯ",
      sortOrder: 5,
      estimatedMinutes: 180
    }
  });

  await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      parentId: tAds.id,
      title: "Объявления VK",
      status: "done",
      priority: "normal",
      sortOrder: 0,
      completedAt: atLocal(-1, 15, 0),
      estimatedMinutes: 90,
      assigneeId: leadMember.id
    }
  });
  await prisma.task.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      parentId: tAds.id,
      title: "Посадочная с осенним меню",
      status: "in_progress",
      priority: "normal",
      sortOrder: 1,
      dueAt: atLocal(2, 18, 0),
      estimatedMinutes: 150,
      assigneeId: leadMember.id
    }
  });

  await prisma.taskDependency.create({
    data: { workspaceId: ws, taskId: tMount.id, dependsOnTaskId: tStand.id }
  });
  await prisma.taskDependency.create({
    data: { workspaceId: ws, taskId: tSite.id, dependsOnTaskId: tPhoto.id }
  });

  await prisma.savedTaskView.createMany({
    data: [
      { workspaceId: ws, name: "Просрочено", filters: { due: "overdue", statuses: ["todo", "in_progress"] } },
      { workspaceId: ws, name: "Северный ветер", filters: { projectId: veter.id } },
      { workspaceId: ws, name: "На этой неделе", filters: { due: "week", statuses: ["todo", "in_progress"] } }
    ]
  });

  const pin = new Date();
  const nStudio = await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: studio.id,
      title: "О студии",
      tags: ["студия", "контур"],
      pinnedAt: pin,
      editedAt: pin,
      body: [
        "ООО «Северный контур» — брендинг, digital и пространства. Офис на Карповке.",
        "",
        "Команда: Мария Волкова, Павел Орлов, Анна Белова.",
        "Клиенты сейчас: [[Бриф: Северный ветер]], [[Концепция: Балтийский причал]], свой [[Шоурум на Васильевском]].",
        "",
        "Правила — в [[Регламент проектов]]. Прайс — в документах, папка «Внутреннее»."
      ].join("\n")
    }
  });
  const nBrief = await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: veter.id,
      title: "Бриф: Северный ветер",
      tags: ["клиент", "ветер"],
      pinnedAt: new Date(pin.getTime() + 1000),
      editedAt: atLocal(-4, 11, 20),
      body: [
        "Сеть кафе, retainer 180 000 ₽/мес до конца года.",
        "Контакт — Ирина Соколова. Голос спокойный, без восклицательных знаков.",
        "",
        "Сейчас в работе: пакеты, осеннее меню, навигация Литейного в черновике.",
        "См. также [[О студии]] и смету Q3 в документах клиента."
      ].join("\n")
    }
  });
  const nPrichal = await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: prichal.id,
      title: "Концепция: Балтийский причал",
      tags: ["клиент", "сайт"],
      editedAt: atLocal(-7, 18, 0),
      body: [
        "Пять разделов, RU сразу, EN в ноябре. Цвета `#1B3A4B` / `#C4B7A6`.",
        "Показ 3 октября. Съёмка терминала — ретушь до 22 сентября.",
        "",
        "Связано с [[О студии]]."
      ].join("\n")
    }
  });
  const nShow = await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: showroom.id,
      title: "Шоурум на Васильевском",
      tags: ["производство", "шоурум"],
      editedAt: atLocal(-1, 9, 40),
      body: [
        "6-я линия В.О., 23. Стойка, LED, латунная табличка, блэкаут на двор.",
        "Монтаж 7–8 октября. Не хватает 6 м ткани — закупка на Обводном.",
        "",
        "Спецификация лежит в документах. Команда — [[О студии]]."
      ].join("\n")
    }
  });
  await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: studio.id,
      title: "Регламент проектов",
      tags: ["регламент"],
      editedAt: atLocal(-15, 12, 0),
      body: [
        "Бриф до старта. Предоплата 50%. Один круг правок на концепции.",
        "Пятничный статус клиенту до 16:00. Часы — в тот же день.",
        "",
        "Полный текст — файл в «Внутреннее». Кратко для новичков: [[О студии]]."
      ].join("\n")
    }
  });
  await prisma.note.create({
    data: {
      workspaceId: ws,
      isTemplate: true,
      title: "Статус клиенту",
      tags: ["шаблон"],
      editedAt: atLocal(-40, 10, 0),
      body: ["## Сделали", "- ", "", "## Ждём с вашей стороны", "- ", "", "## Дальше", "- "].join("\n")
    }
  });
  await prisma.note.create({
    data: {
      workspaceId: ws,
      projectId: studio.id,
      title: "Ежедневная",
      dailyOn: dayUtc(0),
      tags: ["день"],
      editedAt: atLocal(0, 9, 15),
      body: [
        "## Сегодня",
        "- Статус «Северному ветру»",
        "- Дозакупка блэкаута",
        "- Письмо по аренде Карповки",
        "",
        "## Заметки",
        "Ирина может заехать за пакетами на следующей неделе — уточнить слот."
      ].join("\n")
    }
  });
  await prisma.noteRevision.create({
    data: {
      workspaceId: ws,
      noteId: nBrief.id,
      title: "Бриф: Северный ветер",
      tags: ["клиент"],
      body: "Черновик после первой встречи. Бюджет ещё не подтверждён.",
      createdAt: atLocal(-60, 16, 0)
    }
  });
  await rebuildNoteLinks(ws);

  await prisma.inboxItem.createMany({
    data: [
      {
        workspaceId: ws,
        projectId: veter.id,
        title: "Уточнить у Ирины слот фотосессии витрины",
        body: "Хочет утро будня, без гостей в кадре. Петроградская удобнее."
      },
      {
        workspaceId: ws,
        projectId: studio.id,
        title: "Идея: короткий разбор кейсов для HoReCa-клиентов",
        body: "Не блог — PDF на бланке студии, раз в квартал."
      },
      {
        workspaceId: ws,
        title: "Перенести архив макетов 2024 с внешнего диска",
        body: "Диск лежит в шкафу у Марии. Не срочно."
      }
    ]
  });

  const habits = {};
  for (const row of [
    { key: "standup", name: "Утренний созвон студии", note: "10 минут, без слайдов.", weekdays: [0, 1, 2, 3, 4], color: "indigo" },
    { key: "inbox", name: "Разбор инбокса", note: "Очередь пустая или сознательно отложена.", weekdays: [], color: "teal" },
    { key: "friday", name: "Пятничный статус клиентам", note: "Письмо до 16:00 по каждому активному договору.", weekdays: [4], color: "amber" },
    { key: "sport", name: "Зал", note: "После работы, три раза в неделю.", weekdays: [0, 2, 4], color: "rose" }
  ]) {
    habits[row.key] = await prisma.habit.create({
      data: { workspaceId: ws, name: row.name, note: row.note, weekdays: row.weekdays, color: row.color }
    });
  }
  const ticks = [];
  for (let i = 21; i >= 0; i -= 1) {
    const day = dayUtc(-i);
    const js = new Date(day).getUTCDay();
    const weekday = js === 0 ? 6 : js - 1;
    const skipSport = i === 2;
    if (weekday <= 4) ticks.push({ workspaceId: ws, habitId: habits.standup.id, day });
    if (i % 2 === 0) ticks.push({ workspaceId: ws, habitId: habits.inbox.id, day });
    if (weekday === 4 && i !== 0) ticks.push({ workspaceId: ws, habitId: habits.friday.id, day });
    if ([0, 2, 4].includes(weekday) && !skipSport) ticks.push({ workspaceId: ws, habitId: habits.sport.id, day });
  }
  await prisma.habitEntry.createMany({ data: ticks, skipDuplicates: true });

  const listBuy = await prisma.list.create({ data: { workspaceId: ws, name: "Закупка на шоурум" } });
  await prisma.listItem.createMany({
    data: [
      { workspaceId: ws, listId: listBuy.id, label: "Блэкаут 6 м, та же партия", checked: false },
      { workspaceId: ws, listId: listBuy.id, label: "Саморезы скрытого крепления для таблички", checked: true },
      { workspaceId: ws, listId: listBuy.id, label: "Димер LED в нишу стойки", checked: false },
      { workspaceId: ws, listId: listBuy.id, label: "Два комплекта визиток к открытию", checked: false }
    ]
  });
  const listHandover = await prisma.list.create({ data: { workspaceId: ws, name: "Перед сдачей проекта" } });
  await prisma.listItem.createMany({
    data: [
      { workspaceId: ws, listId: listHandover.id, label: "Акт и счёт на остаток" },
      { workspaceId: ws, listId: listHandover.id, label: "Исходники в папке клиента" },
      { workspaceId: ws, listId: listHandover.id, label: "Пароль CMS — только заказчику, не в чат" },
      { workspaceId: ws, listId: listHandover.id, label: "Часы закрыты, таймер остановлен" }
    ]
  });
  const listOffice = await prisma.list.create({ data: { workspaceId: ws, name: "Канцелярия" } });
  await prisma.listItem.createMany({
    data: [
      { workspaceId: ws, listId: listOffice.id, label: "Бумага слоновая кость, 200 листов", checked: true },
      { workspaceId: ws, listId: listOffice.id, label: "Конверты С4 с логотипом", checked: false },
      { workspaceId: ws, listId: listOffice.id, label: "Запас чернил для плоттера", checked: false }
    ]
  });

  await prisma.event.createMany({
    data: [
      {
        workspaceId: ws,
        projectId: studio.id,
        title: "Планерка студии",
        description: "Неделя: ветер, причал, шоурум. Без ноутбуков первые десять минут.",
        location: "Карповка, 5, переговорка",
        allDay: false,
        startAt: atLocal(-((new Date().getDay() + 6) % 7), 10, 0),
        endAt: atLocal(-((new Date().getDay() + 6) % 7), 10, 30),
        colorTag: "slate",
        tz: TZ,
        reminders: [10],
        recurrence: { freq: "weekly", interval: 1, byWeekday: [0], until: null, count: null }
      },
      {
        workspaceId: ws,
        projectId: veter.id,
        title: "Созвон с Ириной Соколовой",
        description: "Пакеты, меню, Литейный.",
        location: "Zoom",
        url: "https://kontur.studio/meet/veter",
        allDay: false,
        startAt: atLocal(2, 11, 0),
        endAt: atLocal(2, 11, 30),
        colorTag: "indigo",
        tz: TZ,
        reminders: [30]
      },
      {
        workspaceId: ws,
        projectId: prichal.id,
        title: "Показ концепции «Балтийский причал»",
        description: "Офис заказчика, экран в переговорке.",
        location: "Третьяковская наб., 8",
        allDay: false,
        startAt: atLocal(14, 15, 0),
        endAt: atLocal(14, 16, 30),
        colorTag: "teal",
        tz: TZ,
        reminders: [1440, 60]
      },
      {
        workspaceId: ws,
        projectId: showroom.id,
        title: "Монтаж шоурума",
        description: "День 1 — стойка и свет. День 2 — текстиль и приёмка.",
        location: "6-я линия В.О., 23",
        allDay: true,
        startAt: dayUtc(18),
        endAt: dayUtc(20),
        colorTag: "amber",
        tz: TZ,
        reminders: [540]
      },
      {
        workspaceId: ws,
        projectId: studio.id,
        title: "Оплата аренды",
        description: "Тинькофф, автоплатёж проверяем вручную в этот день.",
        allDay: true,
        startAt: dayUtc(6),
        endAt: dayUtc(7),
        colorTag: "rose",
        tz: TZ,
        reminders: [540]
      }
    ]
  });

  const accCard = await prisma.account.create({
    data: { workspaceId: ws, name: "Тинькофф, расчётный", kind: "card", currency: "RUB", startingBalance: rub(1860000) }
  });
  const accAlfa = await prisma.account.create({
    data: { workspaceId: ws, name: "Альфа, корпоративная", kind: "card", currency: "RUB", startingBalance: rub(210000) }
  });
  const accCash = await prisma.account.create({
    data: { workspaceId: ws, name: "Касса офиса", kind: "cash", currency: "RUB", startingBalance: rub(64000) }
  });
  const accSave = await prisma.account.create({
    data: { workspaceId: ws, name: "Резерв", kind: "savings", currency: "RUB", startingBalance: rub(320000) }
  });
  await prisma.account.create({
    data: {
      workspaceId: ws,
      name: "Наличные на объекте (архив)",
      kind: "cash",
      currency: "RUB",
      startingBalance: 0,
      archivedAt: atLocal(-45, 12, 0)
    }
  });

  const catIncome = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Клиенты", kind: "income", color: "teal" }
  });
  const catOtherIn = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Прочие поступления", kind: "income", color: "emerald" }
  });
  const catRent = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Аренда", kind: "expense", color: "slate" }
  });
  const catPay = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Зарплата", kind: "expense", color: "indigo" }
  });
  const catPrint = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Подрядчики", kind: "expense", color: "amber" }
  });
  const catAds = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Реклама студии", kind: "expense", color: "rose" }
  });
  const catMat = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Материалы", kind: "expense", color: "orange" }
  });
  const catComm = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Связь и софт", kind: "expense", color: "sky" }
  });
  const catTrip = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Командировки", kind: "expense", color: "violet" }
  });
  const catTax = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Налоги УСН", kind: "expense", color: "red" }
  });
  const catOffice = await prisma.financeCategory.create({
    data: { workspaceId: ws, name: "Канцелярия", kind: "expense", color: "stone" }
  });

  async function tx(type, accountId, occurredAt, note, tags, projectId, lines, extra = {}) {
    return prisma.transaction.create({
      data: {
        workspaceId: ws,
        type,
        accountId,
        toAccountId: extra.toAccountId ?? null,
        note,
        tags,
        projectId,
        occurredAt,
        reconciledAt: extra.reconciledAt ?? null,
        lines: { create: lines.map((line) => ({ workspaceId: ws, categoryId: line.categoryId ?? null, amount: line.amount })) }
      }
    });
  }

  await tx("income", accCard.id, atLocal(-76, 11, 10), "ООО «Северный ветер», retainer июль", ["ветер", "retainer"], veter.id, [
    { categoryId: catIncome.id, amount: rub(180000) }
  ], { reconciledAt: atLocal(-75, 10, 0) });
  await tx("income", accCard.id, atLocal(-59, 15, 40), "Кондитерская «Ласточка», остаток по акту", ["ласточка"], lastocka.id, [
    { categoryId: catIncome.id, amount: rub(90000) }
  ], { reconciledAt: atLocal(-58, 9, 0) });
  await tx("income", accCard.id, atLocal(-45, 11, 10), "ООО «Северный ветер», retainer август", ["ветер", "retainer"], veter.id, [
    { categoryId: catIncome.id, amount: rub(180000) }
  ], { reconciledAt: atLocal(-44, 10, 0) });
  const tVeterPay = await tx(
    "income",
    accCard.id,
    atLocal(-17, 11, 12),
    "ООО «Северный ветер», акт за август (меню + съёмка)",
    ["ветер", "retainer"],
    veter.id,
    [{ categoryId: catIncome.id, amount: rub(240600) }],
    { reconciledAt: atLocal(-16, 10, 0) }
  );
  await tx("income", accCard.id, atLocal(-10, 14, 40), "АО «Балтийский причал», предоплата 50% по счёту 1926-09", ["причал"], prichal.id, [
    { categoryId: catIncome.id, amount: rub(160000) }
  ], { reconciledAt: atLocal(-9, 9, 30) });
  await tx("income", accCard.id, atLocal(-3, 16, 5), "ООО «Северный ветер», сентябрьский retainer", ["ветер", "retainer"], veter.id, [
    { categoryId: catIncome.id, amount: rub(180000) }
  ]);
  await tx("income", accCash.id, atLocal(-21, 13, 0), "Наличные за консультацию по вывеске", ["разовое"], studio.id, [
    { categoryId: catOtherIn.id, amount: rub(12000) }
  ]);

  await tx("expense", accCard.id, atLocal(-76, 9, 0), "Аренда офиса на Карповке, июль", ["аренда"], studio.id, [
    { categoryId: catRent.id, amount: rub(85000) }
  ], { reconciledAt: atLocal(-76, 12, 0) });
  await tx("expense", accCard.id, atLocal(-66, 18, 0), "Зарплата студии, июль", ["зарплата"], studio.id, [
    { categoryId: catPay.id, amount: rub(420000) }
  ], { reconciledAt: atLocal(-65, 10, 0) });
  await tx("expense", accCard.id, atLocal(-62, 11, 20), "УСН за II квартал", ["налоги"], studio.id, [
    { categoryId: catTax.id, amount: rub(38400) }
  ], { reconciledAt: atLocal(-61, 9, 0) });
  await tx("expense", accAlfa.id, atLocal(-55, 10, 15), "Adobe Creative Cloud, год", ["софт"], studio.id, [
    { categoryId: catComm.id, amount: rub(28990) }
  ]);
  await tx("expense", accCard.id, atLocal(-48, 16, 0), "Невская типография: пакеты «Ласточка», допечатка", ["печать", "ласточка"], lastocka.id, [
    { categoryId: catPrint.id, amount: rub(21400) }
  ]);
  await tx("expense", accCard.id, atLocal(-45, 9, 0), "Аренда офиса на Карповке, август", ["аренда"], studio.id, [
    { categoryId: catRent.id, amount: rub(85000) }
  ], { reconciledAt: atLocal(-45, 12, 0) });
  await tx("expense", accCard.id, atLocal(-38, 13, 10), "Невская типография: меню августа", ["печать", "ветер"], veter.id, [
    { categoryId: catPrint.id, amount: rub(18600) }
  ]);
  await tx("expense", accCard.id, atLocal(-35, 18, 0), "Зарплата студии, август", ["зарплата"], studio.id, [
    { categoryId: catPay.id, amount: rub(420000) }
  ], { reconciledAt: atLocal(-34, 10, 0) });
  await tx("expense", accAlfa.id, atLocal(-28, 12, 40), "Figma Professional, команда", ["софт"], studio.id, [
    { categoryId: catComm.id, amount: rub(7200) }
  ]);
  await tx("expense", accCard.id, atLocal(-14, 9, 0), "Аренда офиса на Карповке, сентябрь", ["аренда"], studio.id, [
    { categoryId: catRent.id, amount: rub(85000) }
  ], { reconciledAt: atLocal(-14, 12, 0) });
  await tx("expense", accCard.id, atLocal(-12, 18, 20), "Зарплата студии, аванс сентября", ["зарплата"], studio.id, [
    { categoryId: catPay.id, amount: rub(210000) }
  ]);
  await tx("expense", accCard.id, atLocal(-6, 13, 10), "Невская типография: меню и пакеты, накладная 441", ["печать", "ветер"], veter.id, [
    { categoryId: catPrint.id, amount: rub(46100) }
  ]);
  await tx("expense", accAlfa.id, atLocal(-8, 11, 45), "Яндекс Директ — визитка студии", ["директ"], studio.id, [
    { categoryId: catAds.id, amount: rub(12000) }
  ]);
  await tx("expense", accAlfa.id, atLocal(-19, 9, 30), "VK Реклама — набор в шоурум", ["директ", "шоурум"], showroom.id, [
    { categoryId: catAds.id, amount: rub(8500) }
  ]);
  await tx(
    "expense",
    accCard.id,
    atLocal(-5, 17, 0),
    "Закупка на шоурум: ткань, крепёж и диммеры",
    ["склад", "шоурум"],
    showroom.id,
    [
      { categoryId: catMat.id, amount: rub(18400) },
      { categoryId: catPrint.id, amount: rub(3200) }
    ]
  );
  await tx("expense", accCard.id, atLocal(-4, 8, 15), "Ростелеком, интернет офиса", ["связь"], studio.id, [
    { categoryId: catComm.id, amount: rub(2900) }
  ]);
  await tx("expense", accCash.id, atLocal(-2, 12, 30), "Такси на съёмку терминала", ["командировка"], prichal.id, [
    { categoryId: catTrip.id, amount: rub(1860) }
  ]);
  await tx("expense", accCash.id, atLocal(-7, 14, 0), "Кофе и вода в офис, Лента", ["канцелярия"], studio.id, [
    { categoryId: catOffice.id, amount: rub(2140) }
  ]);
  await tx("expense", accAlfa.id, atLocal(-9, 16, 20), "Бумага слоновая кость и конверты С4", ["канцелярия"], studio.id, [
    { categoryId: catOffice.id, amount: rub(6780) }
  ]);
  await tx("expense", accCard.id, atLocal(-15, 11, 0), "Фабрика: стойка ресепшн, предоплата", ["склад", "шоурум"], showroom.id, [
    { categoryId: catMat.id, amount: rub(148000) }
  ], { reconciledAt: atLocal(-14, 10, 0) });
  await tx("expense", accCash.id, atLocal(-33, 15, 10), "Такси на фабрику, контроль шпона", ["командировка"], showroom.id, [
    { categoryId: catTrip.id, amount: rub(1420) }
  ]);
  await tx("transfer", accCard.id, atLocal(-50, 10, 0), "Перевод в резерв, июль", ["резерв"], null, [{ categoryId: null, amount: rub(40000) }], {
    toAccountId: accSave.id
  });
  await tx("transfer", accCard.id, atLocal(-11, 10, 0), "Перевод в резерв, сентябрь", ["резерв"], null, [{ categoryId: null, amount: rub(50000) }], {
    toAccountId: accSave.id
  });
  await tx("transfer", accCard.id, atLocal(-20, 11, 30), "Пополнение корпоративной карты", ["карта"], null, [{ categoryId: null, amount: rub(80000) }], {
    toAccountId: accAlfa.id
  });

  const budgetRows = [];
  for (const offset of [-2, -1, 0]) {
    budgetRows.push(
      { workspaceId: ws, categoryId: catRent.id, month: monthStart(offset), limitAmount: rub(85000) },
      { workspaceId: ws, categoryId: catPay.id, month: monthStart(offset), limitAmount: rub(420000) },
      { workspaceId: ws, categoryId: catPrint.id, month: monthStart(offset), limitAmount: rub(80000) },
      { workspaceId: ws, categoryId: catAds.id, month: monthStart(offset), limitAmount: rub(25000) },
      { workspaceId: ws, categoryId: catMat.id, month: monthStart(offset), limitAmount: rub(offset === 0 ? 160000 : 40000) },
      { workspaceId: ws, categoryId: catComm.id, month: monthStart(offset), limitAmount: rub(12000) },
      { workspaceId: ws, categoryId: catTrip.id, month: monthStart(offset), limitAmount: rub(15000) },
      { workspaceId: ws, categoryId: catTax.id, month: monthStart(offset), limitAmount: rub(40000) },
      { workspaceId: ws, categoryId: catOffice.id, month: monthStart(offset), limitAmount: rub(8000) }
    );
  }
  await prisma.budget.createMany({ data: budgetRows });

  await prisma.recurringTransaction.createMany({
    data: [
      {
        workspaceId: ws,
        accountId: accCard.id,
        categoryId: catRent.id,
        type: "expense",
        amount: rub(85000),
        note: "Аренда офиса на Карповке",
        interval: "monthly",
        anchorDay: 5,
        nextRunAt: atLocal(6, 9, 0)
      },
      {
        workspaceId: ws,
        accountId: accCard.id,
        categoryId: catComm.id,
        type: "expense",
        amount: rub(2900),
        note: "Ростелеком",
        interval: "monthly",
        anchorDay: 4,
        nextRunAt: atLocal(15, 8, 0)
      },
      {
        workspaceId: ws,
        accountId: accCard.id,
        categoryId: catPay.id,
        type: "expense",
        amount: rub(210000),
        note: "Зарплата, вторая половина месяца",
        interval: "monthly",
        anchorDay: 25,
        nextRunAt: atLocal(6, 18, 0)
      },
      {
        workspaceId: ws,
        accountId: accCard.id,
        categoryId: catIncome.id,
        type: "income",
        amount: rub(180000),
        note: "ООО «Северный ветер», retainer",
        interval: "monthly",
        anchorDay: 5,
        nextRunAt: atLocal(16, 11, 0)
      },
      {
        workspaceId: ws,
        accountId: accAlfa.id,
        categoryId: catComm.id,
        type: "expense",
        amount: rub(7200),
        note: "Figma Professional",
        interval: "monthly",
        anchorDay: 12,
        nextRunAt: atLocal(23, 12, 0),
        pausedAt: atLocal(-2, 12, 0)
      }
    ]
  });
  await prisma.categoryRule.createMany({
    data: [
      { workspaceId: ws, matchText: "Ростелеком", categoryId: catComm.id },
      { workspaceId: ws, matchText: "Яндекс Директ", categoryId: catAds.id },
      { workspaceId: ws, matchText: "VK Реклама", categoryId: catAds.id },
      { workspaceId: ws, matchText: "типография", categoryId: catPrint.id },
      { workspaceId: ws, matchText: "Северный ветер", categoryId: catIncome.id },
      { workspaceId: ws, matchText: "Балтийский причал", categoryId: catIncome.id },
      { workspaceId: ws, matchText: "УСН", categoryId: catTax.id },
      { workspaceId: ws, matchText: "Figma", categoryId: catComm.id },
      { workspaceId: ws, matchText: "Adobe", categoryId: catComm.id },
      { workspaceId: ws, matchText: "Такси", categoryId: catTrip.id }
    ]
  });
  await prisma.savingsGoal.createMany({
    data: [
      {
        workspaceId: ws,
        name: "Подушка на квартал",
        accountId: accSave.id,
        targetAmount: rub(800000),
        targetDate: atLocal(80, 12, 0)
      },
      {
        workspaceId: ws,
        name: "Ремонт шоурума на Васильевском",
        accountId: accSave.id,
        targetAmount: rub(250000),
        targetDate: atLocal(19, 16, 0)
      },
      {
        workspaceId: ws,
        name: "Новый плоттер",
        accountId: accCard.id,
        targetAmount: rub(180000),
        targetDate: atLocal(110, 12, 0)
      }
    ]
  });

  async function stock(data) {
    return prisma.inventoryItem.create({ data: { workspaceId: ws, ...data } });
  }
  const invCards = await stock({ sku: "VIZ-90", name: "Визитки 90×50, пачка", unit: "пач", minStock: 3, projectId: studio.id });
  const invBags = await stock({ sku: "KR-L", name: "Пакет крафт с логотипом, большой", unit: "шт", minStock: 80, projectId: veter.id });
  const invBagsS = await stock({ sku: "KR-S", name: "Пакет крафт малый", unit: "шт", minStock: 40, projectId: lastocka.id });
  const invMenu = await stock({ sku: "MENU-A4", name: "Меню А4, мелованная", unit: "шт", minStock: 40, projectId: veter.id });
  const invRibbon = await stock({ sku: "LENT-BK", name: "Лента чёрная с тиснением", unit: "м", minStock: 20, projectId: lastocka.id });
  const invStick = await stock({ sku: "STICK-LG", name: "Наклейка логотипа, лист", unit: "лист", minStock: 10, projectId: studio.id });
  const invStand = await stock({ sku: "ST-01", name: "Стойка ресепшн, дуб", unit: "шт", minStock: 1, projectId: showroom.id });
  const invLed = await stock({ sku: "LED-24", name: "Кабель LED 24V, 5 м", unit: "шт", minStock: 2, projectId: showroom.id });
  const invPlate = await stock({ sku: "TAB-BR", name: "Табличка латунь", unit: "шт", minStock: 1, projectId: showroom.id });
  const invTex = await stock({ sku: "TXT-BLK", name: "Текстиль блэкаут", unit: "м", minStock: 20, projectId: showroom.id });
  const invLinen = await stock({ sku: "TXT-LIN", name: "Лён на витрину", unit: "м", minStock: 8, projectId: showroom.id });
  const invShelf = await stock({ sku: "SHELF-OAK", name: "Полка дуб, 900 мм", unit: "шт", minStock: 2, projectId: showroom.id });
  const invLamp = await stock({ sku: "LAMP-TR", name: "Светильник трековый", unit: "шт", minStock: 4, projectId: showroom.id });
  const invPaper = await stock({ sku: "PAPER-IV", name: "Бумага слоновая кость", unit: "пач", minStock: 4, projectId: studio.id });
  const invInk = await stock({ sku: "INK-PL", name: "Чернила плоттера", unit: "шт", minStock: 2, projectId: studio.id });
  const invEnv = await stock({ sku: "ENV-C4", name: "Конверт С4 с логотипом", unit: "шт", minStock: 50, projectId: studio.id });
  const invDim = await stock({ sku: "DIM-LED", name: "Диммер LED в нишу", unit: "шт", minStock: 2, projectId: showroom.id });
  const invBanner = await stock({
    sku: "BAN-2024",
    name: "Ролл-ап 2024 (архив)",
    unit: "шт",
    minStock: null,
    projectId: studio.id,
    archivedAt: atLocal(-40, 12, 0)
  });

  await prisma.inventoryMovement.createMany({
    data: [
      { workspaceId: ws, itemId: invCards.id, type: "receipt", quantity: 10, unitCostMinor: rub(420), note: "Тираж апреля", createdAt: atLocal(-90, 12, 0) },
      { workspaceId: ws, itemId: invCards.id, type: "issue", quantity: -4, note: "Встречи июля", createdAt: atLocal(-70, 15, 0) },
      { workspaceId: ws, itemId: invCards.id, type: "issue", quantity: -4, note: "Раздача на встречах сентября", createdAt: atLocal(-8, 15, 0) },
      { workspaceId: ws, itemId: invBags.id, type: "receipt", quantity: 200, unitCostMinor: rub(38), note: "Тираж типографии, июль", createdAt: atLocal(-70, 11, 0) },
      { workspaceId: ws, itemId: invBags.id, type: "issue", quantity: -80, note: "Отгрузка на Петроградскую", createdAt: atLocal(-40, 16, 0) },
      { workspaceId: ws, itemId: invBags.id, type: "receipt", quantity: 500, unitCostMinor: rub(41), note: "Накладная 441, сентябрь", createdAt: atLocal(-6, 14, 0) },
      { workspaceId: ws, itemId: invBags.id, type: "issue", quantity: -480, note: "Отгрузка 500 минус брак 20 — в кафе", createdAt: atLocal(-1, 16, 0) },
      { workspaceId: ws, itemId: invBagsS.id, type: "receipt", quantity: 150, unitCostMinor: rub(22), note: "Допечатка «Ласточка»", createdAt: atLocal(-48, 12, 0) },
      { workspaceId: ws, itemId: invBagsS.id, type: "issue", quantity: -60, note: "Передано кондитерской", createdAt: atLocal(-30, 11, 0) },
      { workspaceId: ws, itemId: invMenu.id, type: "receipt", quantity: 200, unitCostMinor: rub(18), note: "Меню августа", createdAt: atLocal(-38, 14, 0) },
      { workspaceId: ws, itemId: invMenu.id, type: "issue", quantity: -120, note: "Три точки сети", createdAt: atLocal(-36, 10, 0) },
      { workspaceId: ws, itemId: invMenu.id, type: "receipt", quantity: 200, unitCostMinor: rub(19), note: "Осеннее меню, накладная 441", createdAt: atLocal(-6, 14, 10) },
      { workspaceId: ws, itemId: invMenu.id, type: "issue", quantity: -200, note: "Развоз по точкам", createdAt: atLocal(-5, 11, 0) },
      { workspaceId: ws, itemId: invRibbon.id, type: "receipt", quantity: 50, unitCostMinor: rub(85), note: "Заказ к сдаче «Ласточки»", createdAt: atLocal(-80, 13, 0) },
      { workspaceId: ws, itemId: invRibbon.id, type: "issue", quantity: -40, note: "Упаковка коробок", createdAt: atLocal(-55, 12, 0) },
      { workspaceId: ws, itemId: invStick.id, type: "receipt", quantity: 25, unitCostMinor: rub(160), note: "Свой тираж", createdAt: atLocal(-50, 10, 0) },
      { workspaceId: ws, itemId: invStick.id, type: "issue", quantity: -8, note: "Пакеты и вывеска", createdAt: atLocal(-12, 16, 0) },
      { workspaceId: ws, itemId: invStand.id, type: "receipt", quantity: 2, unitCostMinor: rub(148000), note: "Фабрика, две стойки", createdAt: atLocal(-12, 10, 0) },
      { workspaceId: ws, itemId: invLed.id, type: "receipt", quantity: 10, unitCostMinor: rub(890), note: "Склад света", createdAt: atLocal(-20, 14, 0) },
      { workspaceId: ws, itemId: invLed.id, type: "issue", quantity: -4, note: "Тестовая сборка стойки", createdAt: atLocal(-6, 11, 0) },
      { workspaceId: ws, itemId: invPlate.id, type: "receipt", quantity: 3, unitCostMinor: rub(6400), note: "Гравировка", createdAt: atLocal(-18, 13, 0) },
      { workspaceId: ws, itemId: invTex.id, type: "receipt", quantity: 12, unitCostMinor: rub(740), note: "Партия с Обводного", createdAt: atLocal(-9, 12, 0) },
      { workspaceId: ws, itemId: invLinen.id, type: "receipt", quantity: 16, unitCostMinor: rub(520), note: "Витрина шоурума", createdAt: atLocal(-14, 12, 0) },
      { workspaceId: ws, itemId: invLinen.id, type: "issue", quantity: -6, note: "Примерка на макете окна", createdAt: atLocal(-4, 15, 0) },
      { workspaceId: ws, itemId: invShelf.id, type: "receipt", quantity: 4, unitCostMinor: rub(12800), note: "Столярка", createdAt: atLocal(-16, 11, 0) },
      { workspaceId: ws, itemId: invLamp.id, type: "receipt", quantity: 8, unitCostMinor: rub(3400), note: "Треки для зала", createdAt: atLocal(-16, 11, 30) },
      { workspaceId: ws, itemId: invLamp.id, type: "issue", quantity: -2, note: "Брак цоколя, возврат поставщику", createdAt: atLocal(-10, 10, 0) },
      { workspaceId: ws, itemId: invPaper.id, type: "receipt", quantity: 8, unitCostMinor: rub(640), note: "Канцелярия сентября", createdAt: atLocal(-9, 16, 0) },
      { workspaceId: ws, itemId: invPaper.id, type: "issue", quantity: -2, note: "Бланки счетов", createdAt: atLocal(-3, 11, 0) },
      { workspaceId: ws, itemId: invPaper.id, type: "adjustment", quantity: -1, note: "Инвентаризация: пачка вскрыта и списана", createdAt: atLocal(-1, 10, 0) },
      { workspaceId: ws, itemId: invInk.id, type: "receipt", quantity: 4, unitCostMinor: rub(2100), note: "Запас плоттера", createdAt: atLocal(-25, 12, 0) },
      { workspaceId: ws, itemId: invInk.id, type: "issue", quantity: -1, note: "Печать табличек", createdAt: atLocal(-11, 14, 0) },
      { workspaceId: ws, itemId: invEnv.id, type: "receipt", quantity: 200, unitCostMinor: rub(18), note: "Свои конверты", createdAt: atLocal(-40, 13, 0) },
      { workspaceId: ws, itemId: invEnv.id, type: "issue", quantity: -40, note: "Акты и счета клиентам", createdAt: atLocal(-18, 12, 0) },
      { workspaceId: ws, itemId: invDim.id, type: "receipt", quantity: 3, unitCostMinor: rub(1900), note: "К стойке", createdAt: atLocal(-8, 12, 0) },
      { workspaceId: ws, itemId: invBanner.id, type: "receipt", quantity: 1, unitCostMinor: rub(7800), note: "Выставка 2024", createdAt: atLocal(-200, 12, 0) },
      { workspaceId: ws, itemId: invBanner.id, type: "issue", quantity: -1, note: "Списан, конструкция сломана", createdAt: atLocal(-41, 12, 0) }
    ]
  });

  const closedEntries = [
    { taskId: tAds.id, projectId: veter.id, note: "Объявления VK и черновик посадочной", start: atLocal(-1, 10, 0), hours: 3.5 },
    { taskId: tBags.id, projectId: veter.id, note: "Согласование тиража с типографией", start: atLocal(-3, 14, 0), hours: 1.5 },
    { taskId: tPhoto.id, projectId: prichal.id, note: "Разбор исходников терминала", start: atLocal(-4, 11, 0), hours: 2 },
    { taskId: tSite.id, projectId: prichal.id, note: "Каркас главной и услуги", start: atLocal(-2, 10, 30), hours: 5 },
    { taskId: tStand.id, projectId: showroom.id, note: "Выезд на фабрику", start: atLocal(-2, 13, 0), hours: 3 },
    { taskId: tDone.id, projectId: lastocka.id, note: "Сборка архива исходников", start: atLocal(-31, 12, 0), hours: 2 }
  ];
  for (const entry of closedEntries) {
    const endedAt = new Date(entry.start.getTime() + entry.hours * 3600 * 1000);
    await prisma.timeEntry.create({
      data: {
        workspaceId: ws,
        userId: users.owner.id,
        taskId: entry.taskId,
        projectId: entry.projectId,
        note: entry.note,
        startedAt: entry.start,
        endedAt
      }
    });
  }

  const docs = await seedDocuments(ws, projects);
  const briefDoc = docs["Клиенты/Северный ветер/Бриф.txt"];
  const specDoc = docs["Производство/Спецификация_стойки.md"];
  const priceDoc = docs["Внутреннее/Прайс_2026.md"];

  if (briefDoc) {
    await prisma.noteAttachment.create({
      data: { workspaceId: ws, noteId: nBrief.id, documentId: briefDoc.id }
    });
  }

  await prisma.entityLink.createMany({
    data: [
      { workspaceId: ws, sourceType: "note", sourceId: nBrief.id, targetType: "task", targetId: tBags.id, label: "тираж" },
      { workspaceId: ws, sourceType: "note", sourceId: nPrichal.id, targetType: "task", targetId: tSite.id, label: "концепция" },
      { workspaceId: ws, sourceType: "note", sourceId: nShow.id, targetType: "task", targetId: tTextile.id, label: "ткань" },
      { workspaceId: ws, sourceType: "task", sourceId: tStatus.id, targetType: "note", targetId: nBrief.id, label: "клиент" },
      { workspaceId: ws, sourceType: "transaction", sourceId: tVeterPay.id, targetType: "project", targetId: veter.id, label: "август" }
    ]
  });
  if (briefDoc) {
    await prisma.entityLink.create({
      data: { workspaceId: ws, sourceType: "document", sourceId: briefDoc.id, targetType: "project", targetId: veter.id, label: "бриф" }
    });
  }
  if (specDoc) {
    await prisma.entityLink.create({
      data: { workspaceId: ws, sourceType: "document", sourceId: specDoc.id, targetType: "task", targetId: tStand.id, label: "спецификация" }
    });
  }
  if (priceDoc) {
    await prisma.entityLink.create({
      data: { workspaceId: ws, sourceType: "document", sourceId: priceDoc.id, targetType: "note", targetId: nStudio.id, label: "прайс" }
    });
  }

  await prisma.notification.createMany({
    data: [
      {
        workspaceId: ws,
        kind: "task_due",
        title: "Просрочена задача",
        body: "Продлить договор аренды на Карповке",
        entityType: "task",
        entityId: tOverdue.id,
        createdAt: atLocal(-1, 9, 0)
      },
      {
        workspaceId: ws,
        kind: "inventory_low_stock",
        title: "Мало на складе",
        body: "Пакет крафт с логотипом — остаток ниже минимума",
        entityType: "inventory",
        entityId: invBags.id,
        createdAt: atLocal(0, 8, 40)
      },
      {
        workspaceId: ws,
        kind: "event_reminder",
        title: "Созвон с Ириной Соколовой",
        body: "Через два дня, 11:00",
        entityType: "event",
        entityId: null,
        createdAt: atLocal(0, 9, 5),
        readAt: atLocal(0, 9, 20)
      },
      {
        workspaceId: ws,
        kind: "finance_alert",
        title: "Подрядчики в сентябре",
        body: "Печать меню и пакетов уже съела больше половины лимита категории.",
        entityType: "budget",
        createdAt: atLocal(-5, 18, 0)
      }
    ]
  });

  console.log(`Пространство «${WORKSPACE_NAME}» готово (${ws}).`);
  console.log("Вход (пароль у всех: 1111):");
  console.log("  Мария Волкова   volkova@severny-kontur.ru   владелец");
  console.log("  Павел Орлов     orlov@severny-kontur.ru     тимлид");
  console.log("  Анна Белова     belova@severny-kontur.ru    участник");
  if (existingDev) console.log("  Локальный владелец 1 / 1 тоже видит это пространство.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
