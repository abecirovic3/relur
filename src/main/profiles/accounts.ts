import fs from 'node:fs';
import path from 'node:path';
import type { AccountFolder } from '@shared/profiles';
import type { Profile } from '@shared/schemas';
import { accountFolder } from '@shared/setup';
import type { Env } from '../env/scrub';
import { contractHome, expandHome } from '../paths';
import { claudeStateFile, runSetupCheck } from '../setup/check';

const realpath = (p: string) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const isDirectory = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `~/.claude` and the `~/.claude-*` directories in the home folder, `~/.claude` first. */
export function listAccountFolders(homeDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(homeDir);
  } catch {
    return [];
  }
  return names
    .filter(
      (n) => (n === '.claude' || n.startsWith('.claude-')) && isDirectory(path.join(homeDir, n)),
    )
    .sort((a, b) => (a === '.claude' ? -1 : b === '.claude' ? 1 : a.localeCompare(b)))
    .map((n) => path.join(homeDir, n));
}

/** Whether two account folders are the same, after `~` expansion and symlinks. */
export function sameFolder(a: string, b: string, homeDir: string): boolean {
  return realpath(expandHome(a, homeDir)) === realpath(expandHome(b, homeDir));
}

/** Whether a folder is the default one, which profiles select by not setting CLAUDE_CONFIG_DIR. */
export const isDefaultFolder = (folder: string, homeDir: string) =>
  sameFolder(folder, path.join(homeDir, '.claude'), homeDir);

/**
 * The login state of one account folder (spec §6.11). A folder without
 * `.claude.json` is reported as not used, and nothing is run for it, because
 * `claude auth status` would write first-run files into it. For the others
 * Claude Code's own `auth status` answers; nothing in the folder is read
 * (decision D12).
 */
export async function inspectAccountFolder(options: {
  folder: string;
  homeDir: string;
  profiles: Profile[];
  command: string;
  /** Builds the environment for Claude with this folder as its account. */
  envFor: (configDir: string | null) => Env;
}): Promise<AccountFolder> {
  const { homeDir } = options;
  const absolute = expandHome(options.folder, homeDir);
  const isDefault = isDefaultFolder(absolute, homeDir);
  const shown = contractHome(absolute, homeDir);
  const usedBy = options.profiles
    .filter((p) => sameFolder(accountFolder(p), absolute, homeDir))
    .map((p) => p.id);
  const base = { folder: shown, email: null, usedBy };

  if (!fs.existsSync(claudeStateFile(isDefault ? undefined : absolute, homeDir))) {
    return { ...base, state: 'not-used' };
  }
  const check = await runSetupCheck({
    profileId: 'account-folder',
    folder: shown,
    command: options.command,
    env: options.envFor(isDefault ? null : absolute),
  });
  if (check.signedIn.state === 'passed') {
    return { ...base, state: 'signed-in', email: check.signedIn.value.email };
  }
  if (check.signedIn.state === 'action') return { ...base, state: 'signed-out' };
  return { ...base, state: 'unknown' };
}
