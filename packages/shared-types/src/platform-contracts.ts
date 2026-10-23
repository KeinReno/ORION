/**
 * Версии публичных контрактов платформы (PLATFORM_AUDIT G2, docs/platform-api/README.md → «Политика совместимости»).
 * У каждого контракта своя semver-версия; `PLATFORM_API_VERSION` — версия набора (её MAJOR не ниже MAJOR любого контракта).
 * Меняете публичную поверхность — поднимите версию здесь и обновите `docs/platform-api/contracts.snapshot.json`
 * (тест `apps/web/lib/extensions/contract-snapshot.test.ts` падает, пока одно не сходится с другим).
 */
export const CONTRACT_IDS = [
  "module",
  "plugin",
  "event",
  "storage",
  "workspace",
  "theme",
  "surface",
  "permission",
  "integration",
  "agentGateway"
] as const;
export type ContractId = (typeof CONTRACT_IDS)[number];

/**
 * `plugin` покрывает слоты расширения (`SlotContracts`) и `host-api.ts`; `event` — каталог типов доменных событий;
 * `permission` — реестр разрешений; `theme` — токены `ThemeDocument.colors`; `surface` — `SURFACE_IDS`;
 * `agentGateway` совпадает по смыслу с `AGENT_API_VERSION` (`/ai/v1`), но у того своя схема нумерации.
 */
export const PLATFORM_CONTRACT_VERSIONS: Readonly<Record<ContractId, string>> = {
  module: "1.2.0",
  plugin: "1.2.0",
  event: "1.0.0",
  storage: "1.0.0",
  workspace: "1.0.0",
  theme: "1.0.0",
  surface: "1.0.0",
  permission: "1.2.0",
  integration: "1.0.0",
  agentGateway: "1.0.0"
};

export function isContractId(value: string): value is ContractId {
  return (CONTRACT_IDS as readonly string[]).includes(value);
}
