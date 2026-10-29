import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateConfig, HabitatPolicyError, probeProfiles, resolveTaskFile, resolveWorkspaceDirectory, runApprovedProfile, saveReceipt } from '../src/habitat.mjs';

const configOf = (root, enabled = true) => ({
  version: 1, enabled, workspaceRoot: root,
  profiles: [{ id: 'node-test', executable: process.execPath, args: ['-e', 'process.stdin.on("data", c => process.stdout.write(c))'], approved: true, timeoutMs: 2500 }]
});
async function environment() {
  const root = await mkdtemp(join(tmpdir(), 'orion-habitat-'));
  const workdir = join(root, 'work');
  await mkdir(workdir);
  const taskFile = join(workdir, 'task.txt');
  await writeFile(taskFile, 'an authorized local test');
  return { root, workdir, taskFile };
}
function rejectsCode(promise, code) {
  return assert.rejects(promise, err => err instanceof HabitatPolicyError && err.code === code);
}

test('requires opt in, approved immutable executable profile and bounded timeout', async () => {
  const e = await environment();
  const c = configOf(e.root, false);
  await rejectsCode(runApprovedProfile({ config: c, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true }), 'operator_approval_required');
  c.enabled = true;
  await rejectsCode(runApprovedProfile({ config: c, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: false }), 'operator_approval_required');
  c.profiles[0].approved = false;
  await rejectsCode(runApprovedProfile({ config: c, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true }), 'profile_not_approved');
  c.profiles[0].timeoutMs = 0;
  assert.throws(() => validateConfig(c), /invalid_profile/);
});

test('does not allow directory traversal or escaping task-file symlinks', async () => {
  const e = await environment();
  const other = await mkdtemp(join(tmpdir(), 'outside-habitat-'));
  await rejectsCode(resolveWorkspaceDirectory(e.root, other), 'outside_workspace');
  const externalFile = join(other, 'secret.txt');
  await writeFile(externalFile, 'secret');
  const fileLink = join(e.workdir, 'external.txt');
  const { root, cwd } = await resolveWorkspaceDirectory(e.root, e.workdir);
  try {
    await symlink(externalFile, fileLink);
    await rejectsCode(resolveTaskFile(root, cwd, fileLink), 'task_outside_workdir');
  } catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM') throw error;
    // Creating file symlinks on Windows requires Developer Mode or elevation.
  }
  const dirLink = join(e.root, 'external-workdir');
  await symlink(other, dirLink, process.platform === 'win32' ? 'junction' : 'dir');
  await rejectsCode(resolveWorkspaceDirectory(e.root, dirLink), 'outside_workspace');
});

test('does not run probe binaries, only checks installation (not provider auth)', async () => {
  const e = await environment();
  const profiles = await probeProfiles(configOf(e.root));
  assert.deepEqual(profiles, [{ id: 'node-test', installed: true, approved: true, enabled: true, auth: 'not_checked', execution: 'not_attempted' }]);
});

test('does not forward an unrelated secret environment variable to a child', async () => {
  const e = await environment();
  const config = configOf(e.root);
  config.profiles[0].args = ['-e', 'process.stdin.resume();process.stdin.on("end", () => process.stdout.write(process.env.SECRET_API_KEY ?? "absent"))'];
  const receipt = await runApprovedProfile({ config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true,
    env: { PATH: process.env.PATH, SECRET_API_KEY: 'super-secret-value' } });
  assert.equal(receipt.stdoutSha256, createHash('sha256').update('absent').digest('hex'));
});

test('launches approved Node profile without shell and writes hash-only receipt', async () => {
  const e = await environment();
  const config = configOf(e.root);
  const receipt = await runApprovedProfile({ config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true,
    env: { PATH: process.env.PATH, SECRET_API_KEY: 'never-propagate' } });
  assert.equal(receipt.outcome, 'exited');
  assert.equal(receipt.exitCode, 0);
  assert.equal(receipt.stdoutBytes, 'an authorized local test'.length);
  assert.equal(receipt.verified, false);
  assert.equal(JSON.stringify(receipt).includes('authorized local test'), false);
  const file = await saveReceipt(config, receipt);
  const contents = await readFile(file, 'utf8');
  assert.equal(JSON.parse(contents).id, receipt.id);
  assert.equal(contents.includes('SECRET_API_KEY'), false);
});

test('stops a running process after its configured deadline', async () => {
  const e = await environment();
  const config = configOf(e.root);
  config.profiles[0].args = ['-e', 'setInterval(() => {}, 1000)'];
  config.profiles[0].timeoutMs = 1000;
  const receipt = await runApprovedProfile({ config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true });
  assert.equal(receipt.outcome, 'timed_out');
  assert.equal(receipt.verified, false);
});

test('operator can abort process and the result is never a completion claim', async () => {
  const e = await environment();
  const config = configOf(e.root);
  config.profiles[0].args = ['-e', 'setInterval(() => {}, 1000)'];
  const controller = new AbortController();
  const spawnAndAbort = (...args) => {
    const child = spawn(...args);
    setTimeout(() => controller.abort(), 150);
    return child;
  };
  const pending = runApprovedProfile({ config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile, acknowledged: true, signal: controller.signal, spawnImpl: spawnAndAbort });
  const result = await pending;
  assert.equal(result.outcome, 'stopped');
  assert.equal(result.verified, false);
});


test('Windows refuses uncontained launch before a process is spawned', async () => {
  const e = await environment();
  const config = configOf(e.root);
  let called = false;
  await rejectsCode(runApprovedProfile({
    config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile,
    acknowledged: true, platform: 'win32', spawnImpl: () => { called = true; }
  }), 'windows_job_host_required');
  assert.equal(called, false);
});

test('Windows selects only the operator-configured Job Object host and fixed CLI argv', async () => {
  const { EventEmitter } = await import('node:events');
  const { PassThrough } = await import('node:stream');
  const e = await environment();
  const config = configOf(e.root);
  config.profiles[0].windowsHost = process.execPath;
  let observed;
  const spawnImpl = (exe, argv, opts) => {
    observed = { exe, request: JSON.parse(Buffer.from(argv[0], 'base64').toString('utf8')), opts };
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    queueMicrotask(() => { child.stdout.end(); child.stderr.end(); child.emit('close', 0, null); });
    return child;
  };
  const receipt = await runApprovedProfile({
    config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile,
    acknowledged: true, platform: 'win32', spawnImpl
  });
  assert.equal(observed.exe, process.execPath);
  assert.equal(observed.request.Executable, process.execPath);
  assert.deepEqual(observed.request.Args, config.profiles[0].args);
  assert.equal(observed.request.Cwd, e.workdir);
  assert.equal(observed.opts.shell, false);
  assert.equal(receipt.runtime, 'windows-job-object');
  assert.equal(receipt.verified, false);
});


test('Windows rejects a configured but missing native host before launching any CLI', async () => {
  const e = await environment();
  const config = configOf(e.root);
  config.profiles[0].windowsHost = join(e.root, 'missing-habitat-windows-host.exe');
  let spawned = false;
  await rejectsCode(runApprovedProfile({
    config, profileId: 'node-test', workdir: e.workdir, taskFile: e.taskFile,
    acknowledged: true, platform: 'win32', spawnImpl: () => { spawned = true; }
  }), 'windows_job_host_missing');
  assert.equal(spawned, false);
});
