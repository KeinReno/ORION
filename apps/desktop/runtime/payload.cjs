/* eslint-disable @typescript-eslint/no-require-imports */
// Protocol 1. Node built-ins only; this verifier stays in the immutable shell runtime.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, createPublicKey, verify, randomBytes } = require('node:crypto');
const { createGunzip } = require('node:zlib');
const MAGIC = Buffer.from('ORION-PAYLOAD-1\n');
const MAX_MANIFEST = 8 * 1024 * 1024;
const MAX_BYTES = 1024 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tagOk = tag => typeof tag === 'string' && /^v\d+\.\d+\.\d+(?:-windows-beta\.\d+)?$/.test(tag);

function safePath(name) {
  if (typeof name !== 'string' || name.length > 400 || !/^(api|web)\//.test(name) && name !== 'build.json') throw new Error('Invalid payload path');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || [...p].some(c => c.charCodeAt(0) < 32) || /[\\:<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(p))) throw new Error('Unsafe Windows payload path');
  if (parts.some(p => /^\.env(?:\.|$)/i.test(p))) throw new Error('Private configuration in payload');
  return name;
}

function filesIn(root, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Links are not allowed: ${name}`);
    if (entry.isDirectory()) result.push(...filesIn(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error('Unsupported file type');
  }
  return result;
}

function databaseHash(runtime) {
  const root = path.join(runtime, 'api', 'prisma');
  const hash = createHash('sha256');
  for (const file of filesIn(root)) {
    hash.update(file).update('\0').update(fs.readFileSync(path.join(root, file))).update('\0');
  }
  return hash.digest('hex');
}

function baseInfo(runtime) {
  const build = JSON.parse(fs.readFileSync(path.join(runtime, 'build.json'), 'utf8'));
  if (!tagOk(build.tag)) throw new Error('Shell base tag missing');
  return { protocol: 1, platform: 'win32-x64', baseTag: build.tag,
    shellHash: sha(fs.readFileSync(path.join(runtime, 'shell-contract.json'))), databaseHash: databaseHash(runtime) };
}

function readManifest(envelopeBytes, runtime) {
  const envelope = JSON.parse(envelopeBytes.toString('utf8'));
  if (typeof envelope.manifest !== 'string' || typeof envelope.signature !== 'string') throw new Error('Missing payload signature');
  const bytes = Buffer.from(envelope.manifest, 'base64');
  const key = createPublicKey(fs.readFileSync(path.join(runtime, 'update-public-key.pem')));
  if (key.asymmetricKeyType !== 'ed25519' || !verify(null, bytes, key, Buffer.from(envelope.signature, 'base64'))) throw new Error('Invalid payload signature');
  const manifest = JSON.parse(bytes.toString('utf8'));
  const base = baseInfo(runtime);
  if (Object.entries(base).some(([k, v]) => manifest[k] !== v)) throw new Error('Payload incompatible with shell or database; use full installer');
  if (!tagOk(manifest.tag) || !Array.isArray(manifest.files) || manifest.files.length > 100000 || !manifest.files.length) throw new Error('Invalid payload manifest');
  const names = new Set(); let total = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    const folded = file.path.toLowerCase();
    if (names.has(folded) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || (file.source !== undefined && file.source !== 'base')) throw new Error('Invalid file entry');
    names.add(folded); total += file.size;
    if (total > MAX_BYTES) throw new Error('Payload exceeds size limit');
  }
  for (const required of ['api/dist/main.js', 'api/package.json', 'api/prisma/schema.prisma', 'web/index.html', 'build.json']) {
    if (!names.has(required)) throw new Error(`Incomplete payload: ${required}`);
  }
  // Reject file/directory collisions before writing anything.
  for (const name of names) {
    const parts = name.split('/'); parts.pop();
    while (parts.length) { if (names.has(parts.join('/'))) throw new Error('Payload path collision'); parts.pop(); }
  }
  return { manifest, envelope };
}

// Only fresh staging directories are written; failed/interrupted extraction never changes selection.
async function prepare(file, runtime, data, expectedTag) {
  const versions = path.join(data, 'app-updates', 'versions');
  fs.mkdirSync(versions, { recursive: true });
  const stage = fs.mkdtempSync(path.join(versions, '.pending-'));
  const input = fs.createReadStream(file);
  const unzip = createGunzip(); input.on('error', e => unzip.destroy(e)); input.pipe(unzip);
  const iterator = unzip[Symbol.asyncIterator](); let buffer = Buffer.alloc(0); let read = 0;
  async function take(size) {
    while (buffer.length < size) {
      const next = await iterator.next();
      if (next.done) throw new Error('Truncated payload');
      read += next.value.length;
      if (read > MAX_BYTES + MAX_MANIFEST + 1024) throw new Error('Expanded payload exceeds limit');
      buffer = Buffer.concat([buffer, next.value]);
    }
    const result = buffer.subarray(0, size); buffer = buffer.subarray(size); return result;
  }
  try {
    if (!(await take(MAGIC.length)).equals(MAGIC)) throw new Error('Invalid payload magic');
    const length = (await take(4)).readUInt32BE();
    if (length < 1 || length > MAX_MANIFEST) throw new Error('Manifest size limit');
    const { manifest, envelope } = readManifest(await take(length), runtime);
    if (manifest.tag !== expectedTag) throw new Error('Payload release tag mismatch');
    for (const entry of manifest.files) {
      const target = path.join(stage, ...entry.path.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const fd = fs.openSync(target, 'wx'); const hash = createHash('sha256'); let left = entry.size;
      try {
        if (entry.source === 'base') {
          const source = path.join(runtime, ...entry.path.split('/'));
          if (!fs.realpathSync(source).startsWith(fs.realpathSync(runtime) + path.sep) || fs.statSync(source).size !== entry.size) throw new Error('Base file is missing or changed');
          const sourceFd = fs.openSync(source, 'r');
          try {
            const chunk = Buffer.alloc(64 * 1024);
            while (left) {
              const count = fs.readSync(sourceFd, chunk, 0, Math.min(left, chunk.length));
              if (!count) throw new Error('Truncated base file');
              const bytes = chunk.subarray(0, count); fs.writeSync(fd, bytes); hash.update(bytes); left -= count;
            }
          } finally { fs.closeSync(sourceFd); }
        } else {
          while (left) { const chunk = await take(Math.min(left, 64 * 1024)); fs.writeSync(fd, chunk); hash.update(chunk); left -= chunk.length; }
        }
      } finally { fs.closeSync(fd); }
      if (hash.digest('hex') !== entry.sha256) throw new Error(`File integrity failure: ${entry.path}`);
    }
    if (buffer.length || !(await iterator.next()).done) throw new Error('Trailing payload data');
    if (databaseHash(stage) !== manifest.databaseHash) throw new Error('Payload database files differ');
    if (JSON.parse(fs.readFileSync(path.join(stage, 'build.json'), 'utf8')).tag !== manifest.tag) throw new Error('Build tag mismatch');
    fs.writeFileSync(path.join(stage, 'signed-manifest.json'), JSON.stringify(envelope));
    const id = `${manifest.tag}-${randomBytes(8).toString('hex')}`;
    fs.renameSync(stage, path.join(versions, id));
    return { id, tag: manifest.tag };
  } catch (error) { fs.rmSync(stage, { recursive: true, force: true }); throw error; }
  finally { input.destroy(); unzip.destroy(); }
}

function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file);
}
function stateFile(data) { return path.join(data, 'app-updates', 'state.json'); }
function readState(data) { try { return JSON.parse(fs.readFileSync(stateFile(data), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; } }
function versionRoot(data, id) {
  if (typeof id !== 'string' || !/^v\d+\.\d+\.\d+(?:-windows-beta\.\d+)?-[a-f0-9]{16}$/.test(id)) throw new Error('Invalid payload selection');
  return path.join(data, 'app-updates', 'versions', id);
}
function verifyVersion(runtime, data, id) {
  const root = versionRoot(data, id);
  const { manifest } = readManifest(fs.readFileSync(path.join(root, 'signed-manifest.json')), runtime);
  const actual = filesIn(root).filter(f => f !== 'signed-manifest.json');
  if (actual.length !== manifest.files.length) throw new Error('Unexpected payload files');
  for (const file of manifest.files) {
    const target = path.join(root, ...file.path.split('/'));
    if (!fs.realpathSync(target).startsWith(fs.realpathSync(root) + path.sep) || fs.lstatSync(target).isSymbolicLink() || fs.statSync(target).size !== file.size || sha(fs.readFileSync(target)) !== file.sha256) throw new Error('Installed payload integrity failure');
  }
  return root;
}
function queue(runtime, data, id) {
  verifyVersion(runtime, data, id);
  const state = readState(data);
  if (state.trial) throw new Error('Update trial in progress');
  atomic(stateFile(data), { ...state, pending: id });
}
function select(runtime, data) {
  const state = readState(data);
  // A trial that did not acknowledge UI readiness never becomes the active version.
  if (state.trial) { state.failed = state.trial; delete state.trial; delete state.pending; }
  if (state.pending) { state.trial = state.pending; delete state.pending; }
  let id = state.trial || state.active;
  try { if (id) verifyVersion(runtime, data, id); }
  catch {
    state.failed = id;
    if (state.trial) { delete state.trial; id = state.active; }
    else { delete state.active; id = state.previous || null; }
    try { if (id) { verifyVersion(runtime, data, id); state.active = id; } } catch { delete state.active; id = null; }
  }
  atomic(stateFile(data), state);
  return { root: id ? versionRoot(data, id) : runtime, id, trial: Boolean(state.trial) };
}
function settle(data, success) {
  const state = readState(data);
  if (!state.trial) return;
  if (success) { state.previous = state.active || null; state.active = state.trial; delete state.failed; }
  else state.failed = state.trial;
  delete state.trial; atomic(stateFile(data), state);
}
module.exports = { MAGIC, MAX_MANIFEST, MAX_BYTES, sha, safePath, filesIn, baseInfo, databaseHash, readManifest, prepare, atomic, readState, versionRoot, verifyVersion, queue, select, settle };

if (require.main === module) {
  const [command, runtime, data, file, tag] = process.argv.slice(2);
  Promise.resolve().then(async () => {
    if (command === 'prepare') return prepare(file, runtime, data, tag);
    if (command === 'queue') { queue(runtime, data, file); return { queued: true }; }
    throw new Error('Unknown payload command');
  }).then(value => process.stdout.write(JSON.stringify(value))).catch(e => { process.stderr.write(e.message); process.exitCode = 1; });
}
