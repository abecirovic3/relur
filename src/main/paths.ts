import os from 'node:os';
import path from 'node:path';
import { BRAND } from '@shared/brand';

export interface PlatformInfo {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
}

const current: PlatformInfo = {
  platform: process.platform,
  env: process.env,
  homeDir: os.homedir(),
};

/** The names a config or home folder is made from: the app's, or BRAND.legacy for the old app's. */
type FolderNames = { displayName: string; slug: string; homeDirName: string };

/**
 * App config dir (spec §3.4): macOS `~/Library/Application Support/<Name>`,
 * Linux `$XDG_CONFIG_HOME/<slug>` (default `~/.config/<slug>`), Windows `%APPDATA%\<Name>`.
 */
export function appConfigDir(
  { platform, env, homeDir }: PlatformInfo = current,
  names: FolderNames = BRAND,
): string {
  switch (platform) {
    case 'darwin':
      return path.posix.join(homeDir, 'Library', 'Application Support', names.displayName);
    case 'win32':
      return path.win32.join(
        env.APPDATA || path.win32.join(homeDir, 'AppData', 'Roaming'),
        names.displayName,
      );
    default: {
      const xdg = env.XDG_CONFIG_HOME;
      const base = xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(homeDir, '.config');
      return path.posix.join(base, names.slug);
    }
  }
}

/** `~/.<slug>`: holds the default worktree root and user scripts. */
export function appHomeDir(
  { platform, homeDir }: PlatformInfo = current,
  names: FolderNames = BRAND,
): string {
  const p = platform === 'win32' ? path.win32 : path.posix;
  return p.join(homeDir, names.homeDirName);
}

/** Expands a leading `~` (alone or followed by a separator) to the home directory. */
export function expandHome(value: string, homeDir: string = current.homeDir): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDir, value.slice(2));
  return value;
}

/** Writes paths under the home directory as `~/…`, the way the spec's examples do. */
export function contractHome(value: string, homeDir: string = current.homeDir): string {
  if (value === homeDir) return '~';
  const rel = path.relative(homeDir, value);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel))
    return `~/${rel.split(path.sep).join('/')}`;
  return value;
}
