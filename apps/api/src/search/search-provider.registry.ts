import { Injectable } from "@nestjs/common";
import type { SearchableEntityType } from "@orion/shared-types";
import { SEARCH_PROVIDER_ORDER, type SearchProvider } from "./search-provider";

/**
 * Реестр провайдеров поиска. Живёт в собственном крошечном модуле (`SearchRegistryModule`), а не в `SearchModule`:
 * тот импортирует Tasks/Notes (`createAndLink`), и регистрация из этих же модулей через `SearchModule` дала бы цикл.
 */
@Injectable()
export class SearchProviderRegistry {
  private readonly byType = new Map<SearchableEntityType, SearchProvider>();

  register(provider: SearchProvider): void {
    // Два провайдера одного типа молча затёрли бы друг друга — лучше упасть при старте.
    if (this.byType.has(provider.entityType)) {
      throw new Error(`Провайдер поиска для типа «${provider.entityType}» уже зарегистрирован`);
    }
    this.byType.set(provider.entityType, provider);
  }

  /** Провайдеры в стабильном порядке `SEARCH_PROVIDER_ORDER`; неизвестные типы — в конце, по порядку регистрации. */
  list(): SearchProvider[] {
    const rank = (type: SearchableEntityType): number => {
      const index = SEARCH_PROVIDER_ORDER.indexOf(type);
      return index === -1 ? SEARCH_PROVIDER_ORDER.length : index;
    };
    return [...this.byType.values()].sort((a, b) => rank(a.entityType) - rank(b.entityType));
  }
}
