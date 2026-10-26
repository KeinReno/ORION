import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import payload from '../apps/desktop/runtime/payload.cjs';
import { packRuntime } from './build-runtime-payload.mjs';

let dir, base, stage, data, keyFile;
const tag = 'v0.1.0-windows-beta.24';
const baseTag = 'v0.1.0-windows-beta.23';
function put(root, name, body) { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); }
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-payload-'));
  base = path.join(dir, 'base'); stage = path.join(dir, 'stage'); data = path.join(dir, 'data');
  const keys = generateKeyPairSync('ed25519');
  keyFile = path.join(dir, 'private.pem');
  fs.writeFileSync(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  put(base, 'update-public-key.pem', keys.publicKey.export({ type: 'spki', format: 'pem' }));
  for (const root of [base, stage]) {
    put(root, 'shell-contract.json', '{"protocol":1,"nativeHash":"fixture","runtimeHash":"fixture"}');
    put(root, 'build.json', JSON.stringify({ tag: root === base ? baseTag : tag, commit: 'fixture' }));
    put(root, 'api/package.json', '{}'); put(root, 'api/dist/main.js', 'console.log("fixture")');
    put(root, 'api/prisma/schema.prisma', '// unchanged schema');
    put(root, 'api/prisma/migrations/1/migration.sql', '-- unchanged');
    put(root, 'web/index.html', '<html><script>window.ok=true</script></html>');
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
async function prepared() {
  const file = path.join(dir, 'app.orion.gz');
  await packRuntime(stage, base, file, keyFile);
  return { file, ...(await payload.prepare(file, base, data, tag)) };
}
describe('signed application payload', () => {
  it('packs/verifies, preserves data, commits after readiness and retains previous version', async () => {
    put(data, 'documents/precious.txt', 'user data');
    const first = await prepared();
    payload.queue(base, data, first.id);
    expect(payload.select(base, data)).toMatchObject({ id: first.id, trial: true });
    expect(payload.readState(data).active).toBeUndefined();
    payload.settle(data, true);
    expect(payload.select(base, data)).toMatchObject({ id: first.id, trial: false });
    const second = await payload.prepare(first.file, base, data, tag);
    payload.queue(base, data, second.id); payload.select(base, data); payload.settle(data, true);
    expect(payload.readState(data)).toMatchObject({ active: second.id, previous: first.id });
    expect(fs.readFileSync(path.join(data, 'documents/precious.txt'), 'utf8')).toBe('user data');
  });
  it('rolls back an interrupted trial and a failed readiness trial', async () => {
    const first = await prepared(); payload.queue(base, data, first.id); payload.select(base, data); payload.settle(data, true);
    const second = await payload.prepare(first.file, base, data, tag);
    payload.queue(base, data, second.id); payload.select(base, data);
    expect(payload.select(base, data)).toMatchObject({ id: first.id, trial: false });
    payload.queue(base, data, second.id); payload.select(base, data); payload.settle(data, false);
    expect(payload.select(base, data).id).toBe(first.id);
  });
  it('rejects database changes, base changes, wrong signing key and release mismatch', async () => {
    const result = await prepared();
    await expect(payload.prepare(result.file, base, data, baseTag)).rejects.toThrow('tag mismatch');
    put(stage, 'api/prisma/migrations/2/migration.sql', '-- new');
    await expect(packRuntime(stage, base, path.join(dir, 'changed.gz'), keyFile)).rejects.toThrow('Database changed');
    put(base, 'build.json', JSON.stringify({ tag }));
    await expect(payload.prepare(result.file, base, data, tag)).rejects.toThrow('incompatible');
    put(base, 'update-public-key.pem', generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
    await expect(payload.prepare(result.file, base, data, tag)).rejects.toThrow('signature');
  });
  it('requires a full installer after native/runtime contract changes', async () => {
    put(stage, 'shell-contract.json', '{"protocol":1,"nativeHash":"changed"}');
    await expect(packRuntime(stage, base, path.join(dir, 'native.gz'), keyFile)).rejects.toThrow('Native/runtime contract changed');
  });
  it('reuses unchanged baseline files, but refuses altered baseline content', async () => {
    const first = await prepared();
    const envelope = JSON.parse(fs.readFileSync(path.join(payload.versionRoot(data, first.id), 'signed-manifest.json'), 'utf8'));
    const manifest = JSON.parse(Buffer.from(envelope.manifest, 'base64'));
    expect(manifest.files.find(f => f.path === 'api/dist/main.js').source).toBe('base');
    put(base, 'api/dist/main.js', 'altered baseline');
    await expect(payload.prepare(first.file, base, data, tag)).rejects.toThrow('Base file');
  });
  it('rejects tampering, missing files and unexpected files before selection', async () => {
    const result = await prepared();
    const root = payload.versionRoot(data, result.id);
    put(root, 'api/dist/injected.js', 'bad');
    expect(() => payload.queue(base, data, result.id)).toThrow('Unexpected');
    fs.rmSync(path.join(root, 'api/dist/injected.js'));
    put(root, 'api/dist/main.js', 'tampered');
    expect(() => payload.queue(base, data, result.id)).toThrow('integrity');
    fs.rmSync(path.join(root, 'api/dist/main.js'));
    expect(() => payload.queue(base, data, result.id)).toThrow();
    expect(payload.readState(data).active).toBeUndefined();
  });
  it('rejects truncated containers, signature corruption, trailing data and cleans staging', async () => {
    const { file } = await prepared();
    const bytes = fs.readFileSync(file);
    fs.writeFileSync(file, bytes.subarray(0, bytes.length - 20));
    await expect(payload.prepare(file, base, data, tag)).rejects.toThrow();
    expect(fs.readdirSync(path.join(data, 'app-updates/versions')).some(n => n.startsWith('.pending-'))).toBe(false);
    const { gunzipSync } = await import('node:zlib');
    fs.writeFileSync(file, gzipSync(Buffer.concat([gunzipSync(bytes), Buffer.from('extra')])));
    await expect(payload.prepare(file, base, data, tag)).rejects.toThrow('Trailing');
    const raw = gunzipSync(bytes); const at = payload.MAGIC.length + 4;
    const env = JSON.parse(raw.subarray(at, at + raw.readUInt32BE(payload.MAGIC.length)).toString());
    env.signature = Buffer.alloc(64).toString('base64');
    const changed = Buffer.from(JSON.stringify(env)); const length = Buffer.alloc(4); length.writeUInt32BE(changed.length);
    fs.writeFileSync(file, gzipSync(Buffer.concat([payload.MAGIC, length, changed])));
    await expect(payload.prepare(file, base, data, tag)).rejects.toThrow('signature');
  });
  it.each(['../escape', 'api/../escape', 'api/C:/escape', 'api/a\\b', 'web/CON.txt', 'web/a.', 'web/a ', 'api/.env', 'web//x'])('rejects unsafe path %s', name => {
    expect(() => payload.safePath(name)).toThrow();
  });
  it('rejects signed path collisions and size bombs before extracting', () => {
    const manifest = { ...payload.baseInfo(base), tag, files: [
      { path: 'web/A', size: 0, sha256: payload.sha('') }, { path: 'web/a', size: 0, sha256: payload.sha('') }
    ] };
    const envelope = () => { const bytes = Buffer.from(JSON.stringify(manifest)); return Buffer.from(JSON.stringify({ manifest: bytes.toString('base64'), signature: sign(null, bytes, fs.readFileSync(keyFile)).toString('base64') })); };
    expect(() => payload.readManifest(envelope(), base)).toThrow('Invalid file');
    manifest.files[1].path = 'web/b'; manifest.files[1].size = payload.MAX_BYTES + 1;
    expect(() => payload.readManifest(envelope(), base)).toThrow('size limit');
  });
  it('invalidates payload selection after a full installer changes the base', async () => {
    const first = await prepared(); payload.queue(base, data, first.id); payload.select(base, data); payload.settle(data, true);
    put(base, 'build.json', JSON.stringify({ tag: 'v0.1.0-windows-beta.25' }));
    expect(payload.select(base, data)).toMatchObject({ root: base, trial: false });
    expect(payload.readState(data).failed).toBeUndefined();
  });
});
