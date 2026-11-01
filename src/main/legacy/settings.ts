import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';

/**
 * Carrying the settings folder over from the app's previous name (spec §3.5).
 * On the first start under the new name, the old folder is copied whole into
 * the new one, except what is only valid while an app runs (the bridge's
 * cli.json, Chromium's Singleton* lock files) and Chromium's caches. The old
 * folder stays as it was, as a backup.
 */

/** Left out at the top of the folder. */
const SKIPPED_FILES = ['cli.json', 'DevToolsActivePort'];
/** Chromium's caches and crash reports, left out at the top and in `session/`. */
const CACHE_FOLDERS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GPUPersistentCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GraphiteDawnCache',
  'ShaderCache',
  'Shared Dictionary',
  'blob_storage',
  'Crashpad',
];

/** Written into the new folder: where the settings came from, and whether the notice was shown. */
export const MIGRATED_FILE = `migrated-from-${BRAND.legacy.slug}.json`;

export type SettingsMigration =
  | { kind: 'none' }
  /** The old folder was copied; it is still at `from`. */
  | { kind: 'copied'; from: string }
  /** The old app is running, so its database may be mid-write: nothing was copied. */
  | { kind: 'old-app-running'; from: string };

/** Whether a file of the old folder stays behind; `rel` is relative to the folder. */
export function skipped(rel: string): boolean {
  const parts = rel.split(path.sep);
  const name = parts[parts.length - 1] ?? '';
  if (parts.length === 1) {
    return (
      SKIPPED_FILES.includes(name) || name.startsWith('Singleton') || CACHE_FOLDERS.includes(name)
    );
  }
  return parts.length === 2 && parts[0] === 'session' && CACHE_FOLDERS.includes(name);
}

/**
 * Whether the app that owns `folder` is running: Chromium's SingletonLock
 * there is a link to `<host>-<pid>`, and that process exists.
 */
export function folderInUse(folder: string): boolean {
  let target: string;
  try {
    target = fs.readlinkSync(path.join(folder, 'SingletonLock'));
  } catch {
    return false;
  }
  const pid = Number(target.slice(target.lastIndexOf('-') + 1));
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Copies `from` to `to` when `to` doesn't exist yet and `from` does. It copies
 * into a temporary folder next to `to` and renames that at the end, so a copy
 * cut short is never mistaken for the settings; the next start tries again.
 */
export function migrateSettings(
  from: string,
  to: string,
  inUse: (folder: string) => boolean = folderInUse,
): SettingsMigration {
  if (fs.existsSync(to) || !fs.existsSync(from)) return { kind: 'none' };
  if (inUse(from)) return { kind: 'old-app-running', from };
  const tmp = `${to}.copying-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.cpSync(from, tmp, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      filter: (source) => {
        const rel = path.relative(from, source);
        return rel === '' || !skipped(rel);
      },
    });
    fs.writeFileSync(
      path.join(tmp, MIGRATED_FILE),
      `${JSON.stringify({ from, at: new Date().toISOString(), noticeShown: false }, null, 2)}\n`,
    );
    fs.renameSync(tmp, to);
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    // Another copy of the app got there first.
    if (fs.existsSync(to)) return { kind: 'none' };
    throw error;
  }
  return { kind: 'copied', from };
}

/** The old folder to mention, once: null when there is none or it was mentioned. */
export function pendingNotice(configDir: string): string | null {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(configDir, MIGRATED_FILE), 'utf8'));
    return record.noticeShown || typeof record.from !== 'string' ? null : record.from;
  } catch {
    return null;
  }
}

/** Records that the notice was shown, so it isn't again. */
export function noticeShown(configDir: string): void {
  const file = path.join(configDir, MIGRATED_FILE);
  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...record, noticeShown: true }, null, 2)}\n`);
  } catch {
    // Nothing to record.
  }
}
