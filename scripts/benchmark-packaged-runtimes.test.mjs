import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import {
  BenchmarkError,
  allocatePorts,
  assertTempRootIsolated,
  checkPortAvailable,
  inspectRuntime,
  listenerOwnershipScript,
  makeMinimalEnv,
  parseArgs,
  removeCreatedProfile,
  runtimeHostRequest,
  safeChildPath,
  waitPortsReleased,
} from './benchmark-packaged-runtimes.mjs';

test('CLI requires both absolute runtime roots and does not accept unknown flags', () => {
  assert.throws(() => parseArgs([]), { code: 'invalid_arguments' });
  assert.throws(() => parseArgs(['--classic', 'a', '--rust', 'b', '--secret', 'x']), { code: 'invalid_arguments' });
  assert.equal(parseArgs(['--classic', 'C:\\classic', '--rust', 'C:\\rust', '--runs', '3', '--sample-seconds', '5']).runs, 3);
  assert.throws(() => parseArgs(['--classic', 'C:\\classic', '--rust', 'C:\\rust', '--runs', '9']), { code: 'invalid_arguments' });
  assert.equal(parseArgs(['--help']).help, true);
});

test('runtime contract inspection only accepts the documented packaged layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-contract-fixture-'));
  try {
    await writeFile(join(root, 'edition.json'), JSON.stringify({ apiPort: 14000, pgPort: 55442, runtimePort: 14099 }));
    for (const dir of ['postgres/bin', 'api/dist', 'api/prisma']) await mkdir(join(root, dir), { recursive: true });
    for (const file of ['node.exe', 'launcher.cjs', 'ascii-path.cjs', 'payload.cjs', 'postgres/bin/initdb.exe', 'postgres/bin/pg_ctl.exe', 'api/dist/main.js', 'api/prisma/schema.prisma']) {
      await writeFile(join(root, file), 'fixture');
    }
    assert.equal((await inspectRuntime(resolve(root))).root, resolve(root));
    await rm(join(root, 'api/dist/main.js'));
    await assert.rejects(inspectRuntime(resolve(root)), error => error instanceof BenchmarkError && error.code === 'runtime_contract_invalid');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Classic Beta42 fixture does not require edition.json or request Rust diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'classic-beta42-fixture-'));
  try {
    for (const dir of ['postgres/bin', 'api/dist', 'api/prisma']) await mkdir(join(root, dir), { recursive: true });
    for (const file of ['node.exe', 'launcher.cjs', 'ascii-path.cjs', 'payload.cjs', 'postgres/bin/initdb.exe', 'postgres/bin/pg_ctl.exe', 'api/dist/main.js', 'api/prisma/schema.prisma']) {
      await writeFile(join(root, file), 'fixture');
    }
    const inspected = await inspectRuntime(resolve(root), 'classic');
    assert.equal(inspected.edition, null);
    assert.equal(inspected.kind, 'classic');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('port preflight refuses an occupied loopback port', async () => {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  try {
    await assert.rejects(checkPortAvailable(port), error => error instanceof BenchmarkError && error.code === 'port_unavailable');
  } finally { await new Promise(resolveClose => server.close(resolveClose)); }
});

test('allocated port sets are distinct and exclude production/dev defaults', async () => {
  const editions = [
    null,
    { apiPort: 14000, pgPort: 55442, runtimePort: 14099, forbiddenApiPort: 4000, forbiddenPgPort: 55432 },
  ];
  const sets = await allocatePorts(editions);
  const ports = sets.flat();
  assert.deepEqual(sets.map(set => set.length), [2, 3]);
  assert.equal(new Set(ports).size, 5);
  for (const port of ports) assert.ok(![4000, 5433, 55432, 55442].includes(port));
});

test('minimal launch environment drops inherited runtime and credential overrides', () => {
  const env = makeMinimalEnv({
    profileRoot: 'C:\\temp\\profile', dataRoot: 'C:\\temp\\data', platform: 'win32',
    sourceEnv: {
      SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32',
      ORION_DESKTOP_DATA_DIR: 'C:\\user-data', ORION_DESKTOP_API_PORT: '4000',
      DATABASE_URL: 'secret', APP_DATABASE_URL: 'secret', JWT_SECRET: 'secret', SYNC_SECRET: 'secret', STORAGE_DIR: 'secret',
      NODE_OPTIONS: '--require secret',
    },
  });
  assert.deepEqual(Object.keys(env).sort(), ['LOCALAPPDATA', 'ORION_DESKTOP_DATA_DIR', 'PATH', 'ProgramData', 'SystemRoot', 'TEMP', 'TMP', 'WINDIR'].sort());
  assert.equal(env.ORION_DESKTOP_DATA_DIR, join('C:\\temp\\data', 'profile'));
  assert.ok(!Object.keys(env).some(key => /SECRET|DATABASE_URL|STORAGE_|NODE_OPTIONS/.test(key)));
});

test('postgres ownership accepts this run cluster when pg_ctl has already exited', () => {
  const script = listenerOwnershipScript(43210, 9876, {
    executablePrefix: 'C:\\runtime\\postgres\\bin\\',
    commandIncludes: 'C:\\temp\\profile\\postgres',
  });
  assert.match(script, /if\(\$n -eq 9876\)\{exit 0\}/);
  assert.match(script, /\$exe\.StartsWith\('C:\\runtime\\postgres\\bin\\'/);
  assert.match(script, /EndsWith\('postgres.exe'/);
  assert.match(script, /exit 3/);
  assert.throws(() => listenerOwnershipScript(43210, 9876, { executablePrefix: 'C:\\bin\\' }), { code: 'health_not_owned' });
});

test('Classic launch spec does not request Rust diagnostics', () => {
  const launch = runtimeHostRequest({
    runtimeRoot: 'C:\\classic-runtime', dataRoot: 'C:\\tmp\\classic',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
  }, [45101, 45102]);
  const request = JSON.parse(Buffer.from(launch.request, 'base64').toString('utf8'));
  assert.equal(request.Executable, join('C:\\classic-runtime', 'node.exe'));
  assert.equal(launch.minimalEnv.ORION_DESKTOP_API_PORT, '45101');
  assert.equal(launch.minimalEnv.ORION_DESKTOP_PG_PORT, '45102');
  assert.equal('ORION_RUST_RUNTIME_PORT' in launch.minimalEnv, false);
});

test('post-stop port verification waits for release and fails closed while occupied', async () => {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  try {
    await assert.rejects(waitPortsReleased([port], 50), { code: 'port_not_released' });
  } finally { await new Promise(resolveClose => server.close(resolveClose)); }
  await waitPortsReleased([port], 1000);
});

test('cleanup rejects the temp root itself and any path outside it', () => {
  const root = resolve(tmpdir(), 'bench-root');
  assert.throws(() => safeChildPath(root, root), { code: 'cleanup_path_invalid' });
  assert.throws(() => safeChildPath(root, resolve(tmpdir(), 'bench-other')), { code: 'cleanup_path_invalid' });
  assert.equal(safeChildPath(root, join(root, 'run-123')).absoluteCandidate, join(root, 'run-123'));
});

test('profile teardown never reads a sibling of the exact profile', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'benchmark-neighbor-fixture-'));
  const profile = join(tempRoot, 'orion-bench-classic-synthetic');
  const sibling = join(tempRoot, 'neighbor-must-not-be-read');
  await mkdir(profile);
  await mkdir(sibling);
  await writeFile(join(profile, 'owned'), 'synthetic');
  await writeFile(join(sibling, 'sentinel'), 'outside target');
  const visited = [];
  const trackingReaddir = async (path, options) => {
    visited.push(path);
    if (path === tempRoot || path === sibling) throw new Error('read outside approved profile');
    return readdir(path, options);
  };
  try {
    await removeCreatedProfile(profile, tempRoot, rm, trackingReaddir);
    assert.ok(visited.length > 0);
    assert.ok(visited.every(path => path === profile));
    assert.equal((await stat(sibling)).isDirectory(), true);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});

test('temp root must not overlap synthetic runtime or user-data profile roots', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'benchmark-isolation-fixture-'));
  const temp = join(sandbox, 'scratch');
  const localData = join(sandbox, 'user', 'AppData', 'Local');
  const programData = join(sandbox, 'ProgramData');
  const classicRuntime = join(sandbox, 'classic-runtime');
  const rustRuntime = join(sandbox, 'rust-runtime');
  await Promise.all([temp, localData, programData, classicRuntime, rustRuntime].map(path => mkdir(path, { recursive: true })));
  const env = { LOCALAPPDATA: localData, ProgramData: programData, SystemRoot: join(sandbox, 'Windows') };
  try {
    assert.equal(await assertTempRootIsolated(temp, [classicRuntime, rustRuntime], env, sandbox), temp);
    await assert.rejects(assertTempRootIsolated(join(localData, 'com.orion.rust.desktop', 'tmp'), [classicRuntime, rustRuntime], env, sandbox), {
      code: 'temp_root_overlaps_protected_path',
    });
    await assert.rejects(assertTempRootIsolated(join(classicRuntime, 'tmp'), [classicRuntime, rustRuntime], env, sandbox), {
      code: 'temp_root_overlaps_protected_path',
    });
  } finally { await rm(sandbox, { recursive: true, force: true }); }
});

test('profile teardown retries a transient EPERM and removes only the generated child', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'benchmark-cleanup-fixture-'));
  const profile = join(tempRoot, 'orion-bench-classic-synthetic');
  await mkdir(join(profile, 'local-data'), { recursive: true });
  await writeFile(join(profile, 'local-data', 'synthetic.log'), 'fixture');
  let calls = 0;
  const retryingRemove = async (path, options) => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error('synthetic transient lock'), { code: 'EPERM' });
    return rm(path, options);
  };
  try {
    await removeCreatedProfile(profile, tempRoot, retryingRemove);
    assert.equal(calls, 2);
    await assert.rejects(stat(profile));
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});

test('profile teardown preserves data after a persistent cleanup error', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'benchmark-cleanup-block-fixture-'));
  const profile = join(tempRoot, 'orion-bench-rust-synthetic');
  await mkdir(profile);
  await writeFile(join(profile, 'sentinel'), 'fixture');
  try {
    await assert.rejects(removeCreatedProfile(profile, tempRoot, async () => {
      throw Object.assign(new Error('synthetic persistent lock'), { code: 'EPERM' });
    }), error => error instanceof BenchmarkError && error.code === 'profile_cleanup_failed');
    assert.equal((await stat(profile)).isDirectory(), true);
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
});
