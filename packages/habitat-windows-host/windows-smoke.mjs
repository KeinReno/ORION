#!/usr/bin/env node
/**
 * Windows-only native Job Object smoke; run manually on a Windows machine.
 * Usage: node packages/habitat-windows-host/windows-smoke.mjs C:\path\Host.exe
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { runApprovedProfile } from '../habitat/src/habitat.mjs';

if (process.platform !== 'win32') {
  console.error('Windows smoke must run on an actual Windows host');
  process.exit(2);
}
const hostPath = process.argv[2];
if (!hostPath || !isAbsolute(hostPath)) {
  console.error('Pass the absolute path to the built Windows Job Object host executable');
  process.exit(2);
}
const testDir = await mkdtemp(join(tmpdir(), 'kaiden-job-smoke-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error?.code === 'ESRCH') return false; throw error; }
};
const makeRequest = args => Buffer.from(JSON.stringify({
  Executable: process.execPath, Cwd: testDir, Args: args
})).toString('base64');
async function runHost(args, input = '') {
  const child = spawn(hostPath, [makeRequest(args)], {
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.end(input);
  const result = await new Promise((resolve, reject) => {
    const watchdog = setTimeout(() => { child.kill(); reject(Error('native host timed out')); }, 10000);
    child.once('error', error => { clearTimeout(watchdog); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(watchdog);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return result;
}

try {
  const argumentsToCheck = ['with spaces', 'quote"inside', 'ends-with-backslash' + String.fromCharCode(92), 'Тест Unicode'];
  const validation = await runHost([
    '-e', 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(JSON.stringify(process.argv.slice(1))));',
    ...argumentsToCheck
  ], 'sample task');
  assert.equal(validation.code, 0, validation.stderr);
  assert.deepEqual(JSON.parse(validation.stdout), argumentsToCheck);

  // Parent spawns a grandchild. Terminating Job Object host must kill both.
  const pidFile = join(testDir, 'pids.json');
  const fixture = [
    "const fs=require('node:fs');",
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});",
    "fs.writeFileSync(process.argv[1],JSON.stringify({parent:process.pid,grandchild:child.pid}));",
    "setInterval(()=>{},1000);"
  ].join('');
  const host = spawn(hostPath, [makeRequest(['-e', fixture, pidFile])], {
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
  });
  host.stdin.end('sample task');
  let pids = null;
  for (let i = 0; i < 100; i++) {
    try { pids = JSON.parse(await readFile(pidFile, 'utf8')); break; }
    catch { await sleep(100); }
  }
  if (!pids || !Number.isInteger(pids.parent) || !Number.isInteger(pids.grandchild)) {
    host.kill();
    throw Error('failed to start parent/grandchild fixture');
  }
  assert.equal(alive(pids.parent), true);
  assert.equal(alive(pids.grandchild), true);
  host.kill();
  await new Promise(resolve => host.once('close', resolve));
  let bothTerminated = false;
  for (let i = 0; i < 50; i++) {
    if (!alive(pids.parent) && !alive(pids.grandchild)) { bothTerminated = true; break; }
    await sleep(100);
  }
  assert.equal(bothTerminated, true, 'orphan parent/grandchild detected: Job Object containment failed');

  // Exercise the Node-to-native-host abort path used by Agent Hub cancellation.
  const taskFile = join(testDir, 'task.txt');
  const abortPidFile = join(testDir, 'abort-pid.txt');
  await writeFile(taskFile, 'synthetic cancellation task');
  const config = { version: 1, enabled: true, workspaceRoot: testDir, profiles: [{
    id: 'abort-fixture', executable: process.execPath,
    args: ['-e', "require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", abortPidFile],
    windowsHost: hostPath, approved: true, timeoutMs: 5000
  }] };
  const controller = new AbortController();
  const pending = runApprovedProfile({ config, profileId: 'abort-fixture', workdir: testDir, taskFile,
    acknowledged: true, signal: controller.signal });
  let abortPid = null;
  for (let i = 0; i < 50; i++) {
    try { abortPid = Number(await readFile(abortPidFile, 'utf8')); break; }
    catch { await sleep(100); }
  }
  assert.ok(Number.isInteger(abortPid) && abortPid > 0, 'abort fixture did not start');
  controller.abort();
  const receipt = await pending;
  assert.equal(receipt.outcome, 'stopped');
  assert.equal(receipt.verified, false);
  for (let i = 0; i < 50 && alive(abortPid); i++) await sleep(100);
  assert.equal(alive(abortPid), false, 'abort left the approved CLI running');
  console.log('Windows Job Object smoke: stdin, argv, descendant termination and Habitat abort passed');
} finally {
  await rm(testDir, { recursive: true, force: true });
}
