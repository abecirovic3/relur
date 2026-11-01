import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeSessionBin } from '../helper-files';
import {
  folderInUse,
  MIGRATED_FILE,
  migrateSettings,
  noticeShown,
  pendingNotice,
  skipped,
} from './settings';

let root: string;
let from: string;
let to: string;
const notInUse = () => false;

const write = (file: string, content = 'x') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

/** Every file under `dir`, relative, sorted. */
const files = (dir: string): string[] =>
  (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => !fs.lstatSync(path.join(dir, f)).isDirectory())
    .sort();

/** An old settings folder as the app leaves it after running. */
function oldFolder(): void {
  write(path.join(from, 'config.json'), '{"version":1}');
  write(path.join(from, 'state.db'), 'db');
  write(path.join(from, 'state.db-wal'), 'wal');
  write(path.join(from, 'state.db-shm'), 'shm');
  write(path.join(from, 'cli.json'), '{"token":"t"}');
  write(path.join(from, 'skill-sources', 'work', 'team', '.git', 'HEAD'), 'ref');
  write(path.join(from, 'skill-sources', 'work', 'team', 'Cache', 'skill.md'), 'kept');
  write(path.join(from, 'plugins', 'work', 'team', '.claude-plugin', 'plugin.json'), '{}');
  write(path.join(from, 'claude', 'settings.json'), '{}');
  write(path.join(from, 'bin', BRAND.legacy.cliCommand), '#!/bin/sh');
  write(path.join(from, 'session', 'Local Storage', 'leveldb', '000003.log'), 'prefs');
  write(path.join(from, 'session', 'Preferences'), '{}');
  write(path.join(from, 'session', 'Cache', 'Cache_Data', 'index'), 'c');
  write(path.join(from, 'session', 'Code Cache', 'js', 'index'), 'c');
  write(path.join(from, 'session', 'GPUCache', 'index'), 'c');
  write(path.join(from, 'session', 'DawnGraphiteCache', 'index'), 'c');
  fs.symlinkSync('host-1', path.join(from, 'SingletonLock'));
  write(path.join(from, 'SingletonCookie'), 'c');
  fs.symlinkSync('/tmp/x', path.join(from, 'SingletonSocket'));
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-settings-'));
  from = path.join(root, BRAND.legacy.displayName);
  to = path.join(root, BRAND.displayName);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('migrateSettings', () => {
  it('copies the old folder when only it exists, leaving it as it was', () => {
    oldFolder();
    const before = files(from);
    expect(migrateSettings(from, to, notInUse)).toEqual({ kind: 'copied', from });
    expect(files(from)).toEqual(before);
    expect(files(to)).toEqual(
      [
        MIGRATED_FILE,
        `bin/${BRAND.legacy.cliCommand}`,
        'claude/settings.json',
        'config.json',
        'plugins/work/team/.claude-plugin/plugin.json',
        'session/Local Storage/leveldb/000003.log',
        'session/Preferences',
        'skill-sources/work/team/.git/HEAD',
        'skill-sources/work/team/Cache/skill.md',
        'state.db',
        'state.db-shm',
        'state.db-wal',
      ].sort(),
    );
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"version":1}');
    expect(fs.readFileSync(path.join(to, 'state.db-wal'), 'utf8')).toBe('wal');
    expect(fs.readdirSync(root).sort()).toEqual([BRAND.legacy.displayName, BRAND.displayName]);
  });

  it('leaves out cli.json, the Singleton files and Chromium caches', () => {
    oldFolder();
    migrateSettings(from, to, notInUse);
    for (const gone of ['cli.json', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      expect(fs.existsSync(path.join(to, gone))).toBe(false);
    }
    for (const cache of ['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache']) {
      expect(fs.existsSync(path.join(to, 'session', cache))).toBe(false);
    }
  });

  it('changes nothing when both folders exist', () => {
    oldFolder();
    write(path.join(to, 'config.json'), '{"new":true}');
    expect(migrateSettings(from, to, notInUse)).toEqual({ kind: 'none' });
    expect(files(to)).toEqual(['config.json']);
    expect(fs.readFileSync(path.join(to, 'config.json'), 'utf8')).toBe('{"new":true}');
  });

  it('does nothing when neither exists', () => {
    expect(migrateSettings(from, to, notInUse)).toEqual({ kind: 'none' });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('copies nothing while the old app runs, and copies on the next start', () => {
    oldFolder();
    expect(migrateSettings(from, to, () => true)).toEqual({ kind: 'old-app-running', from });
    expect(fs.existsSync(to)).toBe(false);
    expect(migrateSettings(from, to, notInUse).kind).toBe('copied');
  });

  it('leaves no partial folder when the copy fails', () => {
    oldFolder();
    fs.chmodSync(path.join(from, 'claude'), 0o000);
    try {
      expect(() => migrateSettings(from, to, notInUse)).toThrow();
    } finally {
      fs.chmodSync(path.join(from, 'claude'), 0o755);
    }
    expect(fs.readdirSync(root)).toEqual([BRAND.legacy.displayName]);
  });
});

describe('skipped', () => {
  it('skips only at the top and in session/', () => {
    expect(skipped('cli.json')).toBe(true);
    expect(skipped('SingletonLock')).toBe(true);
    expect(skipped(path.join('session', 'Code Cache'))).toBe(true);
    expect(skipped(path.join('skill-sources', 'cli.json'))).toBe(false);
    expect(skipped(path.join('skill-sources', 'x', 'Cache'))).toBe(false);
    expect(skipped(path.join('session', 'Local Storage'))).toBe(false);
  });
});

describe('folderInUse', () => {
  it('is true when SingletonLock names a live process, false otherwise', () => {
    fs.mkdirSync(from);
    expect(folderInUse(from)).toBe(false);
    fs.symlinkSync(`host-${process.pid}`, path.join(from, 'SingletonLock'));
    expect(folderInUse(from)).toBe(true);
    fs.rmSync(path.join(from, 'SingletonLock'));
    fs.symlinkSync('host-2147483646', path.join(from, 'SingletonLock'));
    expect(folderInUse(from)).toBe(false);
  });
});

describe('the notice', () => {
  it('is pending once after a copy', () => {
    oldFolder();
    migrateSettings(from, to, notInUse);
    expect(pendingNotice(to)).toBe(from);
    noticeShown(to);
    expect(pendingNotice(to)).toBeNull();
  });

  it('is never pending without a copy', () => {
    fs.mkdirSync(to);
    expect(pendingNotice(to)).toBeNull();
  });
});

describe('writeSessionBin', () => {
  it('removes the old launcher that came with the settings', () => {
    oldFolder();
    migrateSettings(from, to, notInUse);
    const dir = writeSessionBin(to, '/app/helper');
    expect(fs.readdirSync(dir)).toEqual([BRAND.cliCommand]);
  });
});
