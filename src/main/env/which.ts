import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../paths';
import type { Env } from './scrub';

function isExecutable(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (process.platform !== 'win32') fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds a command the way a shell would, using the given environment's PATH
 * (not the app's own, which on macOS lacks most of the user's PATH). Commands
 * with a path separator are used as given, after `~` expansion.
 */
export function resolveExecutable(command: string, env: Env, homeDir?: string): string | null {
  const extensions =
    process.platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];

  if (command.includes('/') || command.includes(path.sep)) {
    const file = path.resolve(expandHome(command, homeDir));
    return extensions.map((ext) => file + ext).find(isExecutable) ?? null;
  }
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const file = path.join(dir, command + ext);
      if (isExecutable(file)) return file;
    }
  }
  return null;
}
