import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';

/**
 * The compiled helper (scripts/build-helper.ts). The packaged app has it in
 * its Resources folder (`<app>/Contents/Resources/helper`, outside the asar,
 * so it can run); development builds run from the repository, where
 * `npm run build` and `npm run dev` compile it into out/helper.
 */
export function helperPath(where: {
  appPath: string;
  resourcesPath: string | null;
}): string | null {
  const file = where.resourcesPath
    ? path.join(where.resourcesPath, 'helper', BRAND.helperCommand)
    : path.join(where.appPath, 'out', 'helper', BRAND.helperCommand);
  return fs.existsSync(file) ? file : null;
}

/**
 * An AppImage's files live in a folder it mounts at each start (`/tmp/.mount_…`),
 * gone when the app quits, so hooks, the status line and the `<slug>` launcher
 * would point nowhere after a restart. When the app runs from an AppImage
 * (`APPIMAGE` is set, spec §15.6) the helper is copied to `<data dir>/helper`
 * when it differs from the one there, and that copy is used. install.sh puts
 * the same copy there before the first start.
 */
export function stableHelper(
  helper: string,
  dataDir: string,
  appImage: string | undefined,
): string {
  if (!appImage) return helper;
  const copy = path.join(dataDir, 'helper', BRAND.helperCommand);
  try {
    const wanted = fs.readFileSync(helper);
    let current: Buffer | null = null;
    try {
      current = fs.readFileSync(copy);
    } catch {
      // not copied yet
    }
    if (!current?.equals(wanted)) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      const tmp = `${copy}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, wanted, { mode: 0o755 });
      fs.renameSync(tmp, copy);
    }
    return copy;
  } catch (error) {
    console.warn(`Couldn't copy ${BRAND.helperCommand} out of the AppImage: ${String(error)}`);
    return helper;
  }
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** First comment line of the launcher; marks a file as the app's own. */
export const LAUNCHER_MARK = `# ${BRAND.displayName} command line tool`;
/** The same line in the old app's launcher (spec §3.5), which marks it as replaceable. */
export const LEGACY_LAUNCHER_MARK = `# ${BRAND.legacy.displayName} command line tool`;

/** The helper a launcher script runs, or null when it isn't one of the app's. */
export function launcherTarget(script: string): string | null {
  if (!script.includes(LAUNCHER_MARK)) return null;
  const quoted = /^exec '((?:[^']|'\\'')*)' "\$@"$/m.exec(script)?.[1];
  return quoted ? quoted.replace(/'\\''/g, "'") : null;
}

/** The `<slug>` launcher script: runs the helper with its arguments (`<slug> add …`). */
export function launcherScript(helper: string): string {
  return `#!/bin/sh\n${LAUNCHER_MARK}\nexec ${quote(helper)} "$@"\n`;
}

/**
 * Writes the folder that goes first on every session's PATH (spec §7.5):
 * the `<slug>` launcher. Rewritten on every launch, as the helper may move.
 */
export function writeSessionBin(dataDir: string, helper: string): string {
  const dir = path.join(dataDir, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, BRAND.cliCommand), launcherScript(helper), { mode: 0o755 });
  // The old app's launcher came along with its settings (spec §3.5) and runs its helper.
  fs.rmSync(path.join(dir, BRAND.legacy.cliCommand), { force: true });
  return dir;
}
