import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import payload from '../apps/desktop/runtime/payload.cjs';

/** Exact, conservative ABI fingerprint: native source/config plus immutable runtime binaries/helpers. */
export function writeShellContract(root, runtime) {
  const nativeRoot = path.join(root, 'apps/desktop/src-tauri');
  const sources = ['Cargo.toml', 'Cargo.lock', 'tauri.conf.json', 'src/startup.html', '../../web/public/kaiden-192.png', ...payload.filesIn(path.join(nativeRoot, 'src')).filter(f => f.endsWith('.rs') && !f.includes('smoke')).map(f => `src/${f}`), ...payload.filesIn(path.join(nativeRoot, 'capabilities')).map(f => `capabilities/${f}`)].sort();
  const native = createHash('sha256');
  for (const name of sources) native.update(name).update('\0').update(fs.readFileSync(path.join(nativeRoot, name))).update('\0');
  const immutable = ['node.exe', 'launcher.cjs', 'ascii-path.cjs', 'payload.cjs', 'edition.json', ...payload.filesIn(path.join(runtime, 'postgres')).map(f => `postgres/${f}`)].sort();
  const binaries = createHash('sha256');
  for (const name of immutable) binaries.update(name).update('\0').update(fs.readFileSync(path.join(runtime, name))).update('\0');
  const contract = { protocol: 1, nativeHash: native.digest('hex'), runtimeHash: binaries.digest('hex') };
  fs.writeFileSync(path.join(runtime, 'shell-contract.json'), JSON.stringify(contract));
  return contract;
}
