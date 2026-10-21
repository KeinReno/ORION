# Extension Proposal: mobile UI contributions

**PARTIALLY IMPLEMENTED**, alpha.13, 21.10.2026. `NEW_EXTENSION_POINT_REQUIRED`
для оставшихся динамических contribution points. Владелец разрешил реализацию плана.
Минимальный bundled screen contract реализован в `app/runtime/module-registry.ts`:
canonical module ID, icon/label/summary/render/primary; duplicate ID guard и scope
routes/error boundary принадлежат host. Lists добавлен через composition root,
без нового domain branch в shell. Это внутренний Android contract, не G24 SDK.
Plugin sections/overview/policy lifecycle/unregister остаются PROPOSED.
Это предложение public contract, не реализованный SDK/разрешение подключать JS.
Основание: Constitution §6–9; AI_REFACTOR_MIGRATION_MAP: Core владеет settings
shell, modules/plugins добавляют typed sections. Desktop places/slots привязаны
к web host; импортировать apps/web/lib/extensions из Android запрещено.

## Задача
Дать bundled mobile features и позднее plugins один способ добавить экран,
settings section, доступное действие и overview card. Shell владеет компоновкой,
scope/security, navigation и lifecycle; вклад владеет своей функциональностью.
rule/name-object-scope-consequence, rule/structure-before-containers.

## Минимальная предлагаемая поверхность v1

| Contribution | Описание | Ограничение host |
|---|---|---|
| mobile.navigation | Стабильные destination IDs, owner, labels, icon, load screen | Только каталог/закрепления host, не произвольный layout |
| mobile.settings.sections | Page/field descriptors + schemas + scoped bindings | Каждый параметр в общем search index; нет прямого localStorage |
| mobile.capture.actions | Contextual create actions: task/note/finance | Проверка scope/capability, draft guard, никаких скрытых shared writes |
| mobile.overview.cards | Read-model и переход к первоисточнику | Не хранить вторую canonical copy; failure изолирован |

Добавлять мобильные entity-detail slots только после первого реального потребителя
и проверки совпадения с public domain contract; не проектировать универсальный
произвольный renderer заранее. rule/smallest-intervention.

Эскиз типов (не существующий import):

```ts
type MobileScope =
  | { kind: "phone"; workspaceId: string }
  | { kind: "remote"; nodeId: string; fingerprint: string;
      userId: string; workspaceId: string };

type Availability =
  | { state: "ready"; canRead: boolean; canWrite: boolean }
  | { state: "unavailable"; reason: "not-in-build" | "disabled" |
      "forbidden" | "offline" | "unsupported" };

interface MobileContributionIdentity {
  contractVersion: 1;
  id: string;              // owner-qualified, unique and stable
  ownerModuleId: OrionModuleId;
  ownerPluginId?: string;  // validated against actual enabled policy
}
```

Экран получает scope и narrow typed domain ports, navigate и presentation APIs,
не raw tokens/SQLite/full registry/private repository. Конкретные command types
определяются domain owners; нельзя прятать unrestricted command(string, any).
Настройка имеет schema/default/patch binding и scope, а не универсальный JSON bag.

## Lifecycle и проверки
1. Bootstrap регистрирует bundled definitions; уникальность ID и schema валидируются.
2. Host вычисляет renderer support + policy + permissions + offline capability.
3. Lazy load экран только после guard; error boundary изолирует сбой вклада.
4. После выключения убрать UI/commands/subscriptions, сохранить данные и prefs.
5. Повторное включение восстанавливает вклад и настройки; route проверяется заново.
6. При scope switch old callbacks не могут публиковать данные в новый scope.

Personal hide/pin не изменяет workspace enabled. Unknown manifest/contract version
даёт понятный unavailable, не fallback с полными правами. Недоступный plugin не
оставляет clickable search result. rule/cover-reachable-states,
rule/error-states-recovery, rule/preserve-mental-model.

## Размещение и совместимость
Сначала согласовать contract с G24 направлением; начать с минимального public
mobile contract под контролем platform boundary. Отдельный packages/mobile-sdk
создавать при фактическом первом cross-package потребителе, без циклов и копий
OrionModuleId. Не изменять ownership существующих plugins ради удобства mobile.
Default-full профиль сохраняет уже доступные возможности; «нет Android renderer»
не выключает desktop plugin. Первый перенос Tasks/Notes/Finance — с parity tests.
Runtime install, remote JS, APK-per-plugin и произвольные desktop extensions не входят.

Приёмка: unknown/duplicate IDs/version, scope leak, forbidden imports, disabled
host, unregister/re-enable, late callback, per-field search, и synthetic fourth
module без нового if в shell. Desktop и API не меняются в этой реализации.
