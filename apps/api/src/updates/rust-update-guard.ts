import { APP_UPDATE_DEFAULT_REPO } from "@orion/shared-types";
import { parseRustTag } from "./release-feed";

/** Установщик этой редакции. Обычный `ORION_*setup.exe` сюда не подходит. */
export const RUST_INSTALLER_NAME = /^ORION-Rust_.+-setup\.exe$/i;
export const RUST_PRODUCT_ID = "com.orion.rust.desktop";

export interface RustReleaseCheck {
  edition: string | undefined;
  repo: string;
  /** Репозиторий, из которого ORION Rust имеет право брать релизы. Пусто — канала нет. */
  channel?: string | null;
  assetName?: string | null;
  tag?: string | null;
  notes?: string | null;
  sha256?: string | null;
}

/**
 * ORION Rust не ставит чужой релиз. Проверка не смотрит, откуда её вызвали:
 * и проверка, и скачивание, и установка обязаны получить `null` до любого файла.
 * `null` — релиз можно продолжать. Строка — отказ, который видит человек.
 */
export function rustReleaseRefusal(input: RustReleaseCheck): string | null {
  if (input.edition !== "rust") return null;
  const channel = input.channel?.trim() || APP_UPDATE_DEFAULT_REPO;
  if (input.repo.trim() !== channel) {
    return "Запрошенный репозиторий находится вне разрешённого канала ORION Rust. Релиз не будет скачан и установлен.";
  }
  if (!input.tag || !parseRustTag(input.tag)) {
    return "Метка релиза не принадлежит каналу ORION Rust. Релиз классической версии отклонён.";
  }
  if (!input.assetName || !RUST_INSTALLER_NAME.test(input.assetName)) {
    return "Установщик не принадлежит ORION Rust. Файл отклонён.";
  }
  if (!input.notes?.includes(RUST_PRODUCT_ID)) {
    return "В описании релиза нет идентификатора ORION Rust. Установка отклонена.";
  }
  if (!input.sha256 || !/^[0-9a-f]{64}$/i.test(input.sha256)) {
    return "В описании релиза нет контрольной суммы SHA-256 — установщик не будет применён.";
  }
  return null;
}
