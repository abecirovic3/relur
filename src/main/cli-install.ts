import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import {
  LAUNCHER_MARK,
  LEGACY_LAUNCHER_MARK,
  launcherScript,
  launcherTarget,
} from './helper-files';

/** Where Install Command Line Tool… puts the launcher (spec §7.5). */
export function cliTarget(homeDir: string): string {
  return path.join(homeDir, '.local', 'bin', BRAND.cliCommand);
}

/**
 * The old app's launcher next to it (spec §3.5), when it is there and is the
 * old app's own: installing removes it. Anything else by that name is left alone.
 */
function legacyLauncher(homeDir: string): string | null {
  const file = path.join(homeDir, '.local', 'bin', BRAND.legacy.cliCommand);
  try {
    return fs.readFileSync(file, 'utf8').includes(LEGACY_LAUNCHER_MARK) ? file : null;
  } catch {
    return null;
  }
}

/**
 * What the confirmation shows: the path, whether a file there isn't the
 * app's, which helper an existing launcher of the app's runs (for
 * example one from a development build, pointing into the repository), and
 * the old app's launcher that goes.
 */
export function cliInstallInfo(homeDir: string, pathEnv: string, helper: string | null = null) {
  const target = cliTarget(homeDir);
  let foreign = false;
  let replaces: string | null = null;
  try {
    const existing = fs.readFileSync(target, 'utf8');
    foreign = !existing.includes(LAUNCHER_MARK);
    const old = launcherTarget(existing);
    if (old && old !== helper) replaces = old;
  } catch {
    // nothing there yet
  }
  const dir = path.dirname(target);
  return {
    target,
    foreign,
    replaces,
    removesLegacy: legacyLauncher(homeDir),
    onPath: pathEnv.split(path.delimiter).includes(dir),
    exportLine: `export PATH="$HOME/.local/bin:$PATH"`,
  };
}

/**
 * Writes the launcher to ~/.local/bin, after the user confirmed; never with
 * sudo. Refuses to replace a file that isn't the app's own launcher. Removes
 * the old app's launcher, if it is there.
 */
export function installCli(homeDir: string, pathEnv: string, helper: string) {
  const info = cliInstallInfo(homeDir, pathEnv, helper);
  if (info.foreign) {
    throw new Error(
      `${info.target} already exists and isn't ${BRAND.displayName}'s; remove it first`,
    );
  }
  fs.mkdirSync(path.dirname(info.target), { recursive: true });
  const tmp = `${info.target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, launcherScript(helper), { mode: 0o755 });
  fs.renameSync(tmp, info.target);
  if (info.removesLegacy) fs.rmSync(info.removesLegacy, { force: true });
  return info;
}
