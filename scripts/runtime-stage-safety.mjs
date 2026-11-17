import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** pnpm deploy may copy ignored developer profiles into the production package. */
export function removeEnvironmentFiles(packageRoot) {
  for (const name of readdirSync(packageRoot)) {
    if (name === '.env' || name.startsWith('.env.')) {
      rmSync(join(packageRoot, name), { recursive: true, force: true });
    }
  }
}
