#!/usr/bin/env node
/**
 * Download an Orion pull request into a separate Git worktree and run its
 * isolated demo. This never checks out changes into the main sources, touches
 * an installed Orion, merges a PR, or publishes a GitHub Release.
 *
 * From the regular Orion checkout:
 *   node scripts/review-pr.mjs 94
 *   node scripts/review-pr.mjs 94 --download-only
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rawNumber = process.argv[2];
const flags = process.argv.slice(3);
if (!/^[1-9]\d{0,5}$/.test(rawNumber || '') || flags.some(flag => flag !== '--download-only')) {
  console.error('Usage: node scripts/review-pr.mjs <PR number> [--download-only]');
  process.exit(2);
}
const pr = Number(rawNumber);
const downloadOnly = flags.includes('--download-only');
const reviewRoot = path.join(path.dirname(repo), 'ORION-Review');
const destination = path.join(reviewRoot, `PR-${pr}`);

function run(cmd, args, cwd = repo, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd, stdio: opts.capture ? 'pipe' : 'inherit',
    encoding: 'utf8', windowsHide: false, ...opts
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = result.stderr?.trim() || `${cmd} exited with ${result.status}`;
    throw new Error(error);
  }
  return result.stdout?.trim() ?? '';
}

function pnpm(args, cwd) {
  if (process.platform === 'win32') {
    // Windows cannot exec .cmd shims directly. Our arguments contain no shell
    // metacharacters; no user values are interpolated into this command.
    return run('cmd.exe', ['/d', '/s', '/c', `corepack pnpm ${args.join(' ')}`], cwd);
  }
  return run('corepack', ['pnpm', ...args], cwd);
}

async function portOccupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    }
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(true)); // unknown: fail closed
  });
}

function registeredWorktree(folder) {
  const registered = run('git', ['worktree', 'list', '--porcelain'], repo, { capture: true });
  const expected = path.normalize(folder).toLowerCase();
  return registered.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .some(line => path.normalize(line.slice('worktree '.length)).toLowerCase() === expected);
}

async function main() {
  const actualRoot = path.resolve(run('git', ['rev-parse', '--show-toplevel'], repo, { capture: true }));
  if (actualRoot.toLowerCase() !== repo.toLowerCase()) {
    throw new Error('Run this script from the scripts/ directory of the Orion Git checkout.');
  }
  const origin = run('git', ['remote', 'get-url', 'origin'], repo, { capture: true });
  if (!/(?:^|[:/])KeinReno\/ORION(?:\.git)?\/?$/i.test(origin)) {
    throw new Error(`Expected KeinReno/ORION as origin; got ${origin}`);
  }

  console.log(`Fetching PR #${pr} from ${origin}`);
  run('git', ['fetch', '--no-tags', 'origin', `refs/pull/${pr}/head`]);
  const commit = run('git', ['rev-parse', 'FETCH_HEAD'], repo, { capture: true });
  mkdirSync(reviewRoot, { recursive: true });
  if (existsSync(destination)) {
    if (!registeredWorktree(destination)) {
      throw new Error(`Refusing to modify pre-existing non-worktree folder: ${destination}`);
    }
    const dirty = run('git', ['status', '--porcelain', '--untracked-files=normal'], destination, { capture: true });
    if (dirty) throw new Error(`Preview has local edits, refusing to overwrite them:\n${dirty}`);
    run('git', ['checkout', '--detach', commit], destination);
  } else {
    run('git', ['worktree', 'add', '--detach', destination, commit]);
  }

  console.log(`\nPreview sources: ${destination}`);
  console.log(`Commit: ${commit}`);
  console.log('Main checkout and installed Orion were not changed.');
  if (downloadOnly) {
    console.log('Source downloaded. Add no flags to start an isolated preview.');
    return;
  }

  for (const port of [5435, 4010, 3020]) {
    if (await portOccupied(port)) {
      throw new Error(`Port ${port} is occupied. Close another Orion demo/preview before running.`);
    }
  }
  console.log('\nPreparing dependencies in the preview worktree...');
  pnpm(['install', '--frozen-lockfile'], destination);
  console.log('\nStarting a SEPARATE demo on http://localhost:3020');
  console.log('Only the preview worktree receives demo .env files and a demo database.');
  run(process.execPath, ['scripts/launch-demo.mjs'], destination);
}
main().catch(error => { console.error(`\nReview failed: ${error.message}`); process.exitCode = 1; });
