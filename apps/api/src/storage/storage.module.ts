import { Global, Logger, Module, type Provider } from "@nestjs/common";
import { LocalDiskStorage } from "./local-disk.storage";
import { STORAGE_ADAPTER, type StorageAdapter } from "./storage-adapter";
import { WebdavStorage } from "./webdav.storage";

/**
 * Picks the storage driver from `STORAGE_DRIVER` (`local` default, or
 * `webdav`) once at boot. An unknown value throws immediately rather than
 * silently falling back — a misconfigured store should fail loudly, not eat
 * uploads. `@Global` so the documents module (and any future consumer) gets
 * `STORAGE_ADAPTER` without importing this module explicitly.
 */
const storageProvider: Provider = {
  provide: STORAGE_ADAPTER,
  useFactory: (): StorageAdapter => {
    const driver = (process.env.STORAGE_DRIVER ?? "local").trim().toLowerCase();
    switch (driver) {
      case "local":
        return new LocalDiskStorage();
      case "webdav":
        return new WebdavStorage();
      default:
        new Logger("StorageModule").error(`Unknown STORAGE_DRIVER "${driver}" — expected "local" or "webdav"`);
        throw new Error(`Unknown STORAGE_DRIVER "${driver}"`);
    }
  }
};

@Global()
@Module({
  providers: [storageProvider],
  exports: [STORAGE_ADAPTER]
})
export class StorageModule {}
