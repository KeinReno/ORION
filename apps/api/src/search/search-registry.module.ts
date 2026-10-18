import { Module } from "@nestjs/common";
import { SearchProviderRegistry } from "./search-provider.registry";

/** Только реестр провайдеров поиска: его импортируют и домены (чтобы зарегистрироваться), и `SearchModule` (чтобы агрегировать). */
@Module({ providers: [SearchProviderRegistry], exports: [SearchProviderRegistry] })
export class SearchRegistryModule {}
