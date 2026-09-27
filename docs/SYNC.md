# ORION — синхронизация и бэкап через облако (WebDAV)

Отдельный документ, а не раздел `PLAN.md`, потому что тема большая и живёт
дольше одной версии. `PLAN.md` остаётся историей «что и почему сделали»;
здесь — разбор чужого решения (Obsidian **Remotely Save**), архитектура
нашего модуля и осознанные ограничения выбранной модели.

Статус: **проектирование + Стадия 1 в работе.** Стадии 2–3 — только дизайн.

---

## 0. Что просили

1. Модуль, который умеет подключаться к облаку по **WebDAV** (Mail.ru Cloud,
   Яндекс.Диск, Nextcloud, `rclone serve webdav`, NAS).
2. **Бэкап** данных ORION в это облако и восстановление из него.
3. **Общие данные для нескольких пользователей** с разных ПК: владелец даёт
   «ссылку на подключение», остальные вводят её и получают те же данные,
   подгруженные из облака.
4. **Гранулярность**: какие именно данные и каким именно пользователям
   доступны.
5. Побочно — модуль **управления командой и правами**.

Уточнено с пользователем: **общего сервера нет.** Каждый ПК держит свой
локальный Postgres + `apps/api`; единственная общая точка — папка в облаке.
То есть буквальный аналог Remotely Save, но синхронизируем не файлы, а
строки БД.

---

## 1. Как устроен Remotely Save

Версия разбиралась по установленному бандлу (`0.5.25`) и открытым исходникам
(`github.com/remotely-save/remotely-save`, ветка `master`, Apache-2.0).
Актуальный алгоритм v3 переехал в закрытый `pro/src/sync.ts`; открытый
`src/sync.ts` (и форк `sboesen/remotely-sync`) содержит v2 — принцип тот же.

### 1.1. Абстракция «удалённая ФС» (`FakeFs`)

Ядро — интерфейс файловой системы, одинаковый для всех бэкендов
(`src/fsAll.ts`, реализации `fsWebdav.ts`, `fsS3.ts`, `fsDropbox.ts`,
`fsOnedrive.ts`, `fsLocal.ts`, `fsWebdis.ts`, `fsMock.ts`; фабрика —
`fsGetter.ts`). Набор методов:

```
walk() / ls()      перечислить записи (path, mtime, size, isFolder)
stat(key)          метаданные одной записи
readFile(key)      -> ArrayBuffer
writeFile(key, buf, mtime, ctime)
mkdir(key)
rm(key)            файл или папку рекурсивно
rename(from, to)
```

Всё остальное (шифрование, алгоритм слияния) работает **только** через этот
интерфейс и не знает, WebDAV там внизу или S3.

### 1.2. WebDAV-слой (`src/fsWebdav.ts`) — то, ради чего разбирали

- Библиотека — npm-пакет **`webdav`** (тот же, что уже лежит у нас в
  `apps/api/src/storage/webdav.storage.ts`). Берётся web-сборка
  (`webdav/dist/web`).
- **Аутентификация**: Basic и Digest. Логин/пароль с не-ASCII прогоняются
  через `tryEncodeUsernamePassword()` (иначе кириллица в пароле ломает
  заголовок).
- **Листинг** — адаптивная глубина `PROPFIND`. Часть серверов (в т.ч.
  Mail.ru, InfiniCLOUD) не отдаёт `Depth: infinity`. Режимы:
  `manual_1` / `auto` — обход в ширину по уровням, чанками ≤10 записей
  (`walkPartial()` с `deep:false`), иначе один `Depth: infinity`.
- **Базовая папка** (`remoteBaseDir`, у нас будет `/ORION/<workspaceId>`)
  нормализуется (`getWebdavPath()`), при первом обращении создаётся, ведущие
  `/../` вырезаются.
- **CORS**: плагин работает в webview Obsidian, где `fetch` упирается в
  CORS. Решение — **патч транспортного слоя `webdav`**: вместо `fetch`
  вызывается `requestUrl()` Obsidian (нативный HTTP без CORS). Из ответа
  чистятся заголовки `host` / `content-length`, чинится кодировка не
  ISO-8859-1. → Для нас это ключевой момент: **сетевые вызовы WebDAV делаем
  на стороне `apps/api` (Node), а не из браузера/Tauri-webview.** Тогда
  проблемы CORS нет вообще.
- **Особые случаи серверов**: Nextcloud — chunked upload (5 МБ на кусок в
  `/uploads/`, потом сборка); Apache/SabreDAV — дозапись через
  `PATCH X-Update-Range: append`; InfiniCLOUD — лимит 750 записей на запрос.
- Методы: `writeFile`, `readFile` → ArrayBuffer, `deleteFile`,
  `createDirectory` (не рекурсивно), `moveFile`.

### 1.3. Слой шифрования (`src/fsEncrypt.ts`)

Декоратор над `FakeFs` — прозрачно шифрует на запись, расшифровывает на
чтение. Два алгоритма:

- `openssl-base64` — совместимо с `openssl enc`; имя файла → base64url.
- `rclone-base64` — «понимает папки», совместимо с `rclone crypt`.

Шифруются **и содержимое, и имена файлов** (`_encryptName` / `_encryptContent`).
Держится кэш `cacheMapOrigToEnc` (расшифрованное имя → зашифрованное), т.к.
чтобы сделать `stat()` по человеческому пути, надо сперва знать зашифрованный.
Пароль → ключ: KDF внутри модулей `openssl`/`rclone` (соль в контейнере).
Тяжёлая крипта вынесена в Web Worker (`encryptRClone.worker.ts`).

### 1.4. Состояние между синхронизациями

Два независимых хранилища:

- **Локально** — IndexedDB (`src/localdb.ts`): запись на каждую сущность
  прошлой синхронизации — `key`, `mtime`, `size`, `keyRaw`/`keyEnc`. Это
  «что я видел в прошлый раз».
- **На удалёнке** — файл `_remotely-save-metadata-on-remote.json` (или
  `.bin`, когда включено шифрование). Структура:

  ```json
  { "version": "20220220",
    "generatedWhen": 1710000000000,
    "deletions": [ { "key": "notes/foo.md", "actionWhen": 1710000000000 } ] }
  ```

  Сериализация обфусцированная: `JSON → base64url → разворот строки →
  { readme, d }`. **`deletions`** — журнал удалений: как машина B понимает,
  что файл, который у неё есть, на машине A удалили (а не «ещё не
  создали»). Тот же трюк применим у нас (см. §6).

### 1.5. Алгоритм синхронизации (решающая таблица)

Для каждого `key` собираются **четыре времени**:

| источник | что это |
|---|---|
| `mtimeLocal` | локальная запись изменена |
| `mtimeRemote` | удалённая запись изменена |
| `deltimeLocal` | локально удалена (из журнала) |
| `deltimeRemote` | удалена на удалёнке (из `deletions`) |

**Максимум из четырёх → действие:**

| условие | действие |
|---|---|
| `mtimeLocal` максимум, размеры равны | `skipUploading` (ничего) |
| `mtimeLocal` максимум, размеры разошлись | `uploadLocalToRemote` |
| `mtimeRemote` максимум | `downloadRemoteToLocal` |
| `deltimeLocal` максимум | `uploadLocalDelHistToRemote` (удалить на удалёнке + запись в журнал) |
| `deltimeRemote` максимум | `keepRemoteDelHist` (удалить локально) |
| одна сторона больше лимита `skipSizeLargerThan` | error-ветки (`errorLocalTooLargeConflictRemote` и т.п.) |

Разрешение конфликта (когда обе стороны менялись после общей точки):
`keep_newer` / `keep_larger` / `keep_both` (переименовать одну) / `warning`.

Порядок выполнения — три фазы по глубине дерева:
1. `mkdir` — от корня вглубь;
2. удаления — от листьев вверх;
3. заливки/выгрузки — одним уровнем.

### 1.6. Предохранители

- `protectModifyPercentage` (по умолч. 50) — если синк собирается изменить
  больше N % записей, он **останавливается** и просит подтверждения. Спасает
  от «пустая удалёнка снесла весь vault».
- `skipSizeLargerThan` — не трогать гигантские файлы.
- `ignorePaths` / `onlyAllowPaths` — списки glob.
- «Экспорт плана синхронизации» — dry-run, показывает решения по каждому
  файлу без записи.
- Настройки в `data.json` обфусцированы тем же reverse-base64url.

---

## 2. Почему нельзя просто «взять Remotely Save»

| Obsidian + Remotely Save | ORION |
|---|---|
| данные = markdown-файлы в папке | данные = строки Postgres в 6 модулях (notes, tasks, events, finance, documents) + бинарники документов |
| одна ФС на диске | реляционная БД, связи, каскады, RLS, ревизии, `[[wiki-links]]` |
| один пользователь | модель `WorkspaceMember` (owner/member), но **нет потока добавить второго участника** |
| нет понятия «пользователь» на удалёнке | нужна «гранулярность по пользователям» |
| сервера нет by design | `apps/api` есть, просто в выбранной модели крутится на каждом ПК локально |

Из этого два вывода:

1. **Единица синхронизации — не файл, а сущность (строка) модуля.** Значит
   нужен свой сериализатор строки → канонический JSON и обратный upsert,
   аккуратный с внешними ключами и порядком вставки.
2. **Права без сервера — принципиально слабее.** См. §4.

---

## 3. Выбранная модель: облако — хаб, сервера нет

```
   ПК владельца                     ПК участника B
 ┌───────────────┐               ┌───────────────┐
 │ apps/api (лок.)│               │ apps/api (лок.)│
 │ Postgres (лок.)│               │ Postgres (лок.)│
 │  sync-движок   │               │  sync-движок   │
 └───────┬───────┘               └───────┬───────┘
         │        WebDAV (Basic)         │
         └──────────────┬───────────────┘
                        ▼
             ┌────────────────────────┐
             │  Облако: /ORION/<wsId>/ │
             │  manifest, notes/*, …   │
             │  всё зашифровано        │
             └────────────────────────┘
```

- Сетевой код WebDAV — в `apps/api` (Node), **не** в браузере/Tauri →
  никакого CORS, никакого патча транспорта (в отличие от Remotely Save).
- «Общие данные» = обе ноды синхронизируют один и тот же префикс
  `/ORION/<workspaceId>/` в одном облаке.
- Облако видит **один** WebDAV-аккаунт (аккаунт владельца или общий
  технический). Понятие «пользователь ORION» на уровне WebDAV не существует —
  оно живёт только в шифровании (§4).

### Требования к облаку

| Провайдер | WebDAV | Заметки |
|---|---|---|
| **Nextcloud / ownCloud** | да, полноценный | рекомендуется: есть под-аккаунты и ACL на папки → можно ограничивать запись реально |
| **Яндекс.Диск** | `https://webdav.yandex.ru` | app-пароль; лимиты на размер |
| **Mail.ru Cloud** | `https://webdav.cloud.mail.ru` | **только платные тарифы**, нужен пароль приложения («полный доступ к Облаку (WebDAV)»); `Depth: infinity` не поддерживает → режим `manual_1` |
| `rclone serve webdav` / NAS | да | полный контроль |

Модуль не должен зависеть от конкретики провайдера, кроме флага «поддерживает
ли `Depth: infinity`» (иначе — обход по уровням, как в §1.2).

---

## 4. Права доступа без сервера — честные ограничения

**Нельзя** получить серверную модель (RLS + `assertMember` + JWT), когда
общей доверенной точки нет. Что реально достижимо:

### Что даём

- **Конфиденциальность по компартментам.** Владелец заводит «шары» (share) —
  именованные наборы данных (`модуль + фильтр`). Каждой шаре — свой
  симметричный ключ. Данные шары шифруются её ключом **до** выгрузки.
  Участник без ключа шары видит на WebDAV только шум и физически не может
  прочитать. Это и есть «каким именно пользователям доступны какие данные».
- **Отзыв доступа** — ротацией ключа шары: владелец генерит новый ключ,
  перешифровывает шару, раздаёт ключ оставшимся. Отозванный теряет доступ к
  новым данным (старые, что он уже скачал, — уже у него, это неизбежно).
- **Атрибуция и защита от подмены** — у каждой ноды пара ключей; каждая
  выгруженная запись подписывается. Чужая нода видит, кто автор, и ловит
  битые/поддельные файлы.

### Чего НЕ даём (и почему)

- **Жёсткого «только чтение».** У любого, кто знает WebDAV-пароль, есть
  запись в папку. «Read-only участник» — это его клиент сам не пушит
  (кооперативно). Настоящий read-only возможен только если у провайдера есть
  под-аккаунты с ACL на путь (Nextcloud) — тогда участнику даём под-аккаунт
  без права записи в его префикс.
- **Защиты от вредителя внутри команды.** Участник с доступом на запись
  может испортить (перезаписать мусором) даже те шары, что не может
  прочитать. Ловится подписью (§выше) + `protectModifyPercentage` +
  версионированием на удалёнке, но не предотвращается. Для этого нужен
  сервер-арбитр — это уже другая модель (её оставляем на «если появится
  общий сервер», см. `PLAN.md`).

Вывод, который надо проговорить пользователю: **эта схема рассчитана на 2–5
доверяющих друг другу людей**, которым нужна общая база + разделение «кто что
видит», а не на защиту от злонамеренного участника.

---

## 5. Три стадии

### Стадия 1 — Бэкап/восстановление в WebDAV *(готово)*

Одна нода, одно направление. Никакого слияния и конфликтов.

- `POST /workspaces/:id/sync/backup` — сериализовать весь workspace в один
  снапшот, зашифровать, `PUT` в `/ORION/<wsId>/backups/<ISO-время>.orion`.
  Плюс `latest.orion` (перезапись).
- `POST /workspaces/:id/sync/restore` — `GET` снапшота, расшифровать,
  показать превью (сколько чего), по подтверждению — upsert в БД в порядке
  топологии FK.
- `GET /workspaces/:id/sync/backups` — список снапшотов на удалёнке.
- Следующее расширение Стадии 1: автобэкап по расписанию (`@nestjs/schedule`, как `DueTaskCheckerService`) —
  интервал из настроек, `-1` = выкл (та же семантика, что
  `autoRunEveryMilliseconds` у Remotely Save).

Даёт сразу пользу и является фундаментом (WebDAV-клиент + крипта +
сериализатор) для Стадии 2.

### Стадия 2 — Двунаправленная синхронизация построчно *(дизайн)*

Аналог Remotely Save для строк. Раскладка на WebDAV — §6. По каждой
сущности: `updatedAt` → `mtime`, sha256 канонического JSON → аналог
`size`/`md5`. Локальная таблица `SyncEntry` — «что видел в прошлый раз».
`manifest.json` на удалёнке — версия схемы + журнал `deletions`. Таблица
решений — §1.5. Предохранители — §1.6 (обязательно
`protectModifyPercentage`). Порядок применения — по топологии FK, не по
глубине папок.

Крупные риски: рассинхрон часов между ПК (для конфликтов брать не только
`updatedAt`, но и логический счётчик/векторные часы на ноду); каскадные
удаления Postgres vs журнал удалений; ревизии заметок и производные данные
(`NoteLink`) — синкать только первоисточник, производное перестраивать
локально.

### Стадия 3 — Команда, шары, ключи *(дизайн)*

Модели `Peer` / `Share` / `ShareGrant` (§6). Владелец — источник истины по
политике; политика публикуется в облако, зашифрованная «админ-ключом».
«Ссылка на подключение» — §7.

---

## 6. Модель данных (Prisma)

Все модели workspace-scoped, `@@index([workspaceId])`, `@@map`, и **своя
RLS-миграция** (raw SQL, `ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE
POLICY` по `current_setting('app.current_user_id', true)`) — как для любого
модуля, см. `CLAUDE.md`.

```prisma
/// Настроенная удалёнка (одна на workspace на этом узле). Пароль — не в
/// открытом виде: SYNC_SECRET из .env шифрует его перед записью в БД
/// (как Remotely Save обфусцирует data.json, только честной AES).
model SyncRemote {
  id            String   @id @default(uuid())
  workspaceId   String   @unique
  kind          String   // "webdav" (пока единственный)
  url           String
  username      String
  passwordEnc   String   // AES-GCM(SYNC_SECRET), не plaintext
  baseDir       String   @default("/ORION")
  depthInfinity Boolean  @default(true)   // false → обход по уровням (Mail.ru)
  encAlgo       String   @default("rclone-base64")
  autoEveryMs   Int      @default(-1)     // -1 = выкл
  lastRunAt     DateTime?
  lastError     String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@map("sync_remotes")
}

/// Состояние прошлой синхронизации по каждой сущности (Стадия 2).
model SyncEntry {
  id           String   @id @default(uuid())
  workspaceId  String
  module       String   // "note" | "task" | "event" | "transaction" | "document" | ...
  entityId     String
  remoteRev    String   // sha256 канонического JSON, что лежит на удалёнке
  localHash    String   // sha256, что было локально на момент синка
  deletedAt    DateTime?
  syncedAt     DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  @@unique([workspaceId, module, entityId])
  @@index([workspaceId])
  @@map("sync_entries")
}

/// Участник команды (Стадия 3). Идентичность, не аккаунт: пароля нет,
/// вход — по «ссылке на подключение».
model Peer {
  id          String   @id @default(uuid())
  workspaceId String
  displayName String
  publicKey   String   // ed25519, для подписи выгрузок и атрибуции
  isOwner     Boolean  @default(false)
  revokedAt   DateTime?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  grants    ShareGrant[]
  @@index([workspaceId])
  @@map("sync_peers")
}

/// Компартмент: именованный срез данных со своим ключом шифрования.
model Share {
  id          String   @id @default(uuid())
  workspaceId String
  name        String
  /// Массив селекторов: [{ module: "note", filter: { tagsAny: ["work"] } }, ...]
  /// filter пуст → весь модуль. Пустой selectors → весь workspace ("общая шара").
  selectors   Json
  keyVersion  Int      @default(1)   // растёт при ротации/отзыве
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  grants    ShareGrant[]
  @@index([workspaceId])
  @@map("sync_shares")
}

/// Кто в какую шару допущен и с какими правами.
model ShareGrant {
  id          String   @id @default(uuid())
  workspaceId String
  shareId     String
  peerId      String
  perms       String   @default("read")   // "read" | "write" (write — кооперативно, см. §4)
  /// Ключ шары, завёрнутый на публичный ключ участника (X25519 sealed box).
  wrappedKey  String
  keyVersion  Int
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  share     Share     @relation(fields: [shareId], references: [id], onDelete: Cascade)
  peer      Peer      @relation(fields: [peerId], references: [id], onDelete: Cascade)
  @@unique([shareId, peerId])
  @@index([workspaceId])
  @@map("sync_share_grants")
}
```

`Workspace` в `schema.prisma` дополняется обратными связями:
`syncRemote SyncRemote?`, `syncEntries SyncEntry[]`, `syncPeers Peer[]`,
`syncShares Share[]`, `syncGrants ShareGrant[]`.

---

## 7. Раскладка на WebDAV

```
/ORION/<workspaceId>/
  manifest.json                 обфусц.: версия схемы, список шар+keyVersion,
                                журнал deletions [{module,id,when}]
  policy.enc                    Peer[] / Share[] / ShareGrant[], шифр. админ-ключом
  snapshots/                    Стадия 1
    2026-09-08T12-00-00Z.orion
    latest.orion
  e/                            Стадия 2 — по одной записи на сущность
    note/<id>.enc               канонический JSON строки, шифр. ключом шары
    task/<id>.enc
    event/<id>.enc
    finance-transaction/<id>.enc
    document/<id>.enc            метаданные строки Document
  blob/<documentId>/<sha256>    бинарь документа (через тот же StorageAdapter-seam)
```

Имя `<id>` — это UUID сущности, не человеческое имя, поэтому шифровать сами
имена (как Remotely Save) не обязательно: UUID не выдаёт содержимого.
Шифруется тело каждого `.enc`. `manifest.json` обфусцируется reverse-base64url
(как у Remotely Save) — не секрет, но «не редактируй руками».

---

## 8. «Ссылка на подключение»

Один base64url-блоб (не URL с query — чтобы случайно не утёк в логи/историю):

```
ORION1.<base64url(json)>
```

`json` (перед кодированием — зашифрован пассфразой, которую владелец
передаёт участнику отдельным каналом; или, если «ссылка сама и есть
секрет», — без пассфразы, но тогда любой, кто её увидел, — в команде):

```json
{
  "v": 1,
  "workspaceId": "…",
  "peer": { "id": "…", "displayName": "Аня" },
  "remote": { "kind": "webdav", "url": "https://webdav.cloud.mail.ru",
              "username": "…", "password": "…", "baseDir": "/ORION",
              "depthInfinity": false },
  "peerPrivateKey": "…",            // ed25519 приватный этого участника
  "grants": [                        // какие шары и их ключи — «какие данные видит»
    { "shareId": "…", "name": "Проект X", "perms": "read", "key": "…", "keyVersion": 3 }
  ],
  "encAlgo": "rclone-base64"
}
```

Ввод ссылки на ноде участника:
1. Записать `SyncRemote`, `Peer` (себя), `Share`/`ShareGrant` из `grants`.
2. Первый `restore`-подобный проход: скачать и расшифровать доступные шары →
   upsert в локальный Postgres.
3. Дальше — обычный цикл синхронизации (Стадия 2).

Владелец генерит ссылку в панели: выбирает участника (или создаёт), отмечает
шары и `read/write` → модуль собирает блоб.

---

## 9. API-контракт (`workspaces/:workspaceId/sync/...`)

Инварианты модуля из `CLAUDE.md` соблюдаются: маршрут
`workspaces/:workspaceId/...`, каждый метод сервиса —
`assertMember` + `withUser`, валидация — zod из `shared-types`, наружу —
DTO через `toDto`.

| Метод | Назначение | Стадия |
|---|---|---|
| `GET  /sync/remote` | текущая настройка удалёнки (без пароля) | 1 |
| `PUT  /sync/remote` | задать/изменить удалёнку; пароль шифруется в `passwordEnc` | 1 |
| `POST /sync/remote/test` | проверить соединение (PROPFIND базовой папки) | 1 |
| `POST /sync/backup` | снапшот → облако | 1 |
| `GET  /sync/backups` | список снапшотов | 1 |
| `POST /sync/restore` | `{ snapshot, dryRun }` — превью или применение | 1 |
| `POST /sync/run` | полный двунаправленный синк; `{ dryRun }` даёт план | 2 |
| `GET  /sync/status` | `lastRunAt`, `lastError`, кол-во расхождений | 2 |
| `GET  /sync/peers` `POST /sync/peers` `DELETE /sync/peers/:id` | команда | 3 |
| `GET  /sync/shares` `POST /sync/shares` `PATCH /sync/shares/:id` | шары | 3 |
| `POST /sync/shares/:id/grant` `DELETE .../grant/:peerId` | доступы | 3 |
| `POST /sync/peers/:id/link` | собрать «ссылку на подключение» | 3 |

---

## 10. Слои клиента

Как везде в ORION (`shared-types → core → core-react → panel`):

1. `packages/shared-types/src/sync.ts` — zod-схемы Стадии 1:
   `syncRemoteSchema`, `syncRemoteInputSchema`, `backupRefSchema`,
   `backupResultSchema`, `restoreInputSchema`, `restorePreviewSchema`.
   Типы `connectionLinkSchema` и `shareSelectorSchema` зарезервированы для Стадии 3.
2. `packages/core/src/api/api-client.ts` — методы
   `getSyncRemote / putSyncRemote / testSyncRemote / runBackup / listBackups
   / restoreBackup`. Методы Стадий 2–3 пока отсутствуют намеренно.
3. `packages/core-react/src/use-sync.ts` — `useSyncRemote`,
   `useSaveSyncRemote`, `useTestSyncRemote`, `useRunBackup`, `useBackups`,
   `useRestoreBackup`; `queryKey: ["sync", workspaceId, …]`.
4. `apps/web/panels/SyncPanel.tsx` — панель `PanelShell/PanelHeader/PanelBody`.
   Разделы: **Облако** (форма WebDAV + «Проверить»), **Бэкапы** (список +
   «Создать» + «Восстановить…» с обязательным dry-run preview и отдельным
   подтверждением). UI Стадий 2–3 не показывается как готовая функция.
5. `apps/web/lib/panel-registry.ts` — одна строка:
   `{ id: "sync", label: "Синхронизация", icon: RefreshCw, component: SyncPanel }`.

---

## 11. Чек-лист: Стадия 1

| # | Файл | Действие |
|---|---|---|
| 1 | `apps/api/prisma/schema.prisma` | модель `SyncRemote` + обратная связь в `Workspace`; `pnpm db:migrate` |
| 2 | `apps/api/prisma/migrations/…sync_rls/` | RLS-политика для `sync_remotes` (raw SQL) |
| 3 | `packages/shared-types/src/sync.ts` + `index.ts` | zod-схемы Стадии 1 |
| 4 | `apps/api/src/sync/webdav-remote.ts` | тонкая обёртка `webdav` (createClient, PROPFIND, put/get/list, режим `manual_1`) — можно опереться на существующий `storage/webdav.storage.ts` |
| 5 | `apps/api/src/sync/sync-crypto.ts` | AES-GCM для `passwordEnc` (ключ = `SYNC_SECRET`); шифр тела снапшота (пассфраза → ключ через scrypt/argon2, соль в контейнере) |
| 6 | `apps/api/src/sync/snapshot.service.ts` | `serialize(workspaceId)` → канонический JSON всех модулей + бинарники; `apply(snapshot, {dryRun})` → upsert в порядке FK |
| 7 | `apps/api/src/sync/sync.service.ts` | `getRemote/putRemote/testRemote/backup/listBackups/restore`; `assertMember` + `withUser`; `toDto` |
| 8 | `apps/api/src/sync/sync.controller.ts` | маршруты §9 Стадии 1, `ZodValidationPipe` |
| 9 | `apps/api/src/sync/sync.module.ts` | `imports: [AuthModule, WorkspacesModule]`; провайдеры Стадии 1 |
| 10 | `apps/api/src/app.module.ts` | `SyncModule` в `imports` |
| 11 | `packages/core/src/api/api-client.ts` | методы Стадии 1 |
| 12 | `packages/core-react/src/use-sync.ts` + `index.ts` | хуки Стадии 1 |
| 13 | `apps/web/panels/SyncPanel.tsx` | разделы «Облако» и «Бэкапы» |
| 14 | `apps/web/lib/panel-registry.ts` | строка регистрации |
| 15 | `apps/api/.env(.example)` | `SYNC_SECRET=` (32 байта base64) |

Гейт перед коммитом — `pnpm quality`; CI дополнительно запускает API/RLS integration suite.

---

## 12. Открытые вопросы и риски

- **Mail.ru WebDAV** — только платные тарифы, пароль приложения, нет
  `Depth: infinity`. Проверить на живом аккаунте до обещаний пользователю.
  Запасной вариант для демо — `rclone serve webdav` или Nextcloud в Docker
  рядом с `infra/`.
- **Часы разных ПК** — для Стадии 2 `updatedAt` недостаточно; закладываем
  per-node логический счётчик в `SyncEntry`/`manifest`.
- **Каскады Postgres** (`onDelete: Cascade`) — удаление workspace/аккаунта
  сносит кучу строк разом; журнал `deletions` не должен раздуться —
  синхронизировать удаление только корневых сущностей, каскад
  воспроизводить на приёмнике его же FK.
- **Производные данные** — `NoteLink`, `NoteRevision`, развёртка recurrence
  событий: синкать первоисточник, производное перестраивать локально
  (у `NotesService` уже есть `syncOutgoingLinks` / `reresolveIncomingLinks`).
- **Бинарники документов** могут быть большими — chunked upload (см. §1.2),
  `skipSizeLargerThan`, и не держать их в снапшоте Стадии 1 целиком, а
  ссылками на `blob/…` с отдельной заливкой.
- **Секрет `SYNC_SECRET`** в `.env` на каждом ПК — если его нет, пароль
  WebDAV в БД нечем шифровать; поведение: модуль отказывается сохранять
  удалёнку, а не пишет plaintext.
- **Конкуренция с v0.12 «Документы»** — там уже есть `apps/api/src/storage/`
  с `webdav.storage.ts` и `StorageModule`. Переиспользуем зависимость
  `webdav` и, возможно, `StorageAdapter` для `blob/…`. Не дублировать,
  согласовать имена env (`WEBDAV_URL` там — для блобов документов, у нас
  удалёнка задаётся из UI и живёт в БД).
