import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { writeShellContract } from './runtime-shell-contract.mjs';

const root = path.resolve(import.meta.dirname, '..');
const temporary = [];
function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-package-test-'));
  temporary.push(dir);
  return dir;
}
function put(dir, name, data) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('packaged ORION-R runtime configuration', () => {
  it('reads the edition beside the launcher without a source checkout', () => {
    const dir = scratch();
    const runtime = path.join(dir, 'runtime');
    fs.mkdirSync(runtime);
    for (const file of ['launcher.cjs', 'ascii-path.cjs', 'payload.cjs']) {
      fs.copyFileSync(path.join(root, 'apps/desktop/runtime', file), path.join(runtime, file));
    }
    fs.copyFileSync(path.join(root, 'orion-rust/edition.json'), path.join(runtime, 'edition.json'));
    const result = spawnSync(process.execPath, [path.join(runtime, 'launcher.cjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ORION_DESKTOP_DATA_DIR: path.join(dir, 'data'), ORION_DESKTOP_API_PORT: '4000' }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/не занимает порты обычного ORION/);
    expect(result.stderr).not.toMatch(/edition\.json/);
    expect(fs.existsSync(path.join(dir, 'data'))).toBe(false);
  });

  it('does not write even a log inside the Classic Tauri profile on refusal', () => {
    const dir = scratch();
    const runtime = path.join(dir, 'runtime');
    fs.mkdirSync(runtime);
    for (const file of ['launcher.cjs', 'ascii-path.cjs', 'payload.cjs']) {
      fs.copyFileSync(path.join(root, 'apps/desktop/runtime', file), path.join(runtime, file));
    }
    fs.copyFileSync(path.join(root, 'orion-rust/edition.json'), path.join(runtime, 'edition.json'));
    const classic = path.join(dir, 'com.orion.desktop');
    fs.mkdirSync(classic);
    put(classic, 'sentinel', 'unchanged');
    const result = spawnSync(process.execPath, [path.join(runtime, 'launcher.cjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, LOCALAPPDATA: dir, ORION_DESKTOP_DATA_DIR: classic, ORION_DESKTOP_API_PORT: '14000' }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/не использует каталог обычного ORION/);
    expect(fs.readdirSync(classic)).toEqual(['sentinel']);
    expect(fs.readFileSync(path.join(classic, 'sentinel'), 'utf8')).toBe('unchanged');
  });

  it('refuses a junction that resolves inside a Classic profile before writing', () => {
    const dir = scratch();
    const runtime = path.join(dir, 'runtime');
    fs.mkdirSync(runtime);
    for (const file of ['launcher.cjs', 'ascii-path.cjs', 'payload.cjs']) {
      fs.copyFileSync(path.join(root, 'apps/desktop/runtime', file), path.join(runtime, file));
    }
    fs.copyFileSync(path.join(root, 'orion-rust/edition.json'), path.join(runtime, 'edition.json'));
    const classic = path.join(dir, 'com.orion.desktop');
    const alias = path.join(dir, 'alias');
    fs.mkdirSync(classic);
    fs.symlinkSync(classic, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const result = spawnSync(process.execPath, [path.join(runtime, 'launcher.cjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, LOCALAPPDATA: dir, ORION_DESKTOP_DATA_DIR: path.join(alias, 'nested'), ORION_DESKTOP_API_PORT: '14000' }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/не использует каталог обычного ORION/);
    expect(fs.readdirSync(classic)).toEqual([]);
  });

  it('refuses the Classic development database port without creating data', () => {
    const dir = scratch();
    const runtime = path.join(dir, 'runtime');
    fs.mkdirSync(runtime);
    for (const file of ['launcher.cjs', 'ascii-path.cjs', 'payload.cjs']) {
      fs.copyFileSync(path.join(root, 'apps/desktop/runtime', file), path.join(runtime, file));
    }
    fs.copyFileSync(path.join(root, 'orion-rust/edition.json'), path.join(runtime, 'edition.json'));
    const data = path.join(dir, 'data');
    const result = spawnSync(process.execPath, [path.join(runtime, 'launcher.cjs')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, ORION_DESKTOP_DATA_DIR: data, ORION_DESKTOP_API_PORT: '14000', ORION_DESKTOP_PG_PORT: '5433' }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/dev 5433/);
    expect(fs.existsSync(data)).toBe(false);
  });

  it('binds the packaged edition file to the immutable shell fingerprint', () => {
    const dir = scratch();
    const native = path.join(dir, 'apps/desktop/src-tauri');
    for (const name of ['Cargo.toml', 'Cargo.lock', 'tauri.conf.json', 'src/startup.html']) put(native, name, name);
    put(dir, 'apps/web/public/kaiden-192.png', 'icon');
    put(native, 'src/main.rs', 'source');
    put(native, 'capabilities/main.json', '{}');
    const runtime = path.join(dir, 'runtime');
    for (const name of ['node.exe', 'launcher.cjs', 'ascii-path.cjs', 'payload.cjs', 'edition.json', 'postgres/bin/pg_ctl.exe']) put(runtime, name, name);
    const first = writeShellContract(dir, runtime);
    put(runtime, 'edition.json', 'changed');
    expect(writeShellContract(dir, runtime).runtimeHash).not.toBe(first.runtimeHash);
    fs.rmSync(path.join(runtime, 'edition.json'));
    expect(() => writeShellContract(dir, runtime)).toThrow();
  });
});
