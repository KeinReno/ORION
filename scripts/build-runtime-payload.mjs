// Builds an application package from a production stage; never compiles Rust or bundles Node/PostgreSQL.
// Usage: node scripts/build-runtime-payload.mjs <stage-runtime> <installed-base-runtime> <output.orion.gz>
// ORION_UPDATE_PRIVATE_KEY_FILE points to an Ed25519 PEM outside the repository.
import fs from 'node:fs';
import path from 'node:path';
import { createPrivateKey, createPublicKey, sign, createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import payload from '../apps/desktop/runtime/payload.cjs';

export async function packRuntime(stage, baseRuntime, output, privateKeyFile) {
  const base = payload.baseInfo(baseRuntime);
  if (payload.databaseHash(stage) !== base.databaseHash) throw new Error('Database changed: use full installer');
  const build = JSON.parse(fs.readFileSync(path.join(stage, 'build.json'), 'utf8'));
  const key = createPrivateKey(fs.readFileSync(privateKeyFile));
  const publicKey = createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const trusted = createPublicKey(fs.readFileSync(path.join(baseRuntime, 'update-public-key.pem'))).export({ type: 'spki', format: 'pem' });
  if (key.asymmetricKeyType !== 'ed25519' || publicKey !== trusted) throw new Error('Signing key does not match installed trust key');
  const names = [...payload.filesIn(path.join(stage, 'api')).map(f => `api/${f}`), ...payload.filesIn(path.join(stage, 'web')).map(f => `web/${f}`), 'build.json'];
  const files = [];
  for (const name of names) {
    payload.safePath(name);
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of fs.createReadStream(path.join(stage, name))) { hash.update(chunk); size += chunk.length; }
    files.push({ path: name, size, sha256: hash.digest('hex') });
  }
  const manifest = Buffer.from(JSON.stringify({ ...base, tag: build.tag, commit: build.commit, files }));
  const envelope = Buffer.from(JSON.stringify({ manifest: manifest.toString('base64'), signature: sign(null, manifest, key).toString('base64') }));
  // Same validator as the client; fail before producing an invalid release artifact.
  payload.readManifest(envelope, baseRuntime);
  if (envelope.length > payload.MAX_MANIFEST) throw new Error('Manifest too large');
  const length = Buffer.alloc(4); length.writeUInt32BE(envelope.length);
  async function* content() {
    yield payload.MAGIC; yield length; yield envelope;
    for (const file of files) yield* fs.createReadStream(path.join(stage, file.path));
  }
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  try {
    await pipeline(Readable.from(content()), createGzip({ level: 6 }), fs.createWriteStream(`${output}.part`, { flags: 'wx' }));
    fs.renameSync(`${output}.part`, output);
  } catch (e) { fs.rmSync(`${output}.part`, { force: true }); throw e; }
  return { tag: build.tag, files: files.length, bytes: fs.statSync(output).size };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [stage, base, output] = process.argv.slice(2);
  if (!stage || !base || !output || !process.env.ORION_UPDATE_PRIVATE_KEY_FILE) throw new Error('Usage: build-runtime-payload.mjs <stage-runtime> <base-runtime> <output.orion.gz>; set ORION_UPDATE_PRIVATE_KEY_FILE');
  console.log(await packRuntime(stage, base, output, process.env.ORION_UPDATE_PRIVATE_KEY_FILE));
}
