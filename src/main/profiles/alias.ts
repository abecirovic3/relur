import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../paths';

type ShellKind = 'zsh' | 'bash' | 'fish';

export function shellKind(shell: string): ShellKind | null {
  const name = path.basename(shell);
  return name === 'zsh' || name === 'bash' || name === 'fish' ? name : null;
}

/** A path that needs no quoting inside the alias. */
const SAFE_PATH = /^[\w@%+=:,./~-]+$/;

/**
 * The optional terminal shortcut for a profile with its own folder (spec
 * §6.11): `alias claude-<id>='CLAUDE_CONFIG_DIR=<folder> claude'`. Fish has no
 * `VAR=value command` form in aliases, so it uses `env` and `$HOME`. Null for
 * folders whose path would need quoting.
 */
export function aliasLine(
  profileId: string,
  folder: string,
  kind: ShellKind | null,
): string | null {
  if (!SAFE_PATH.test(folder)) return null;
  const name = `claude-${profileId}`;
  if (kind === 'fish') {
    const fishFolder = folder.startsWith('~/') ? `$HOME/${folder.slice(2)}` : folder;
    return `alias ${name} 'env CLAUDE_CONFIG_DIR=${fishFolder} claude'`;
  }
  return `alias ${name}='CLAUDE_CONFIG_DIR=${folder} claude'`;
}

/**
 * The startup file of the user's shell: `~/.zshrc` (honouring ZDOTDIR),
 * `~/.bashrc`, or fish's `config.fish`. Null for other shells.
 */
export function shellRcFile(kind: ShellKind | null, env: Record<string, string>, homeDir: string) {
  switch (kind) {
    case 'zsh':
      return path.join(env.ZDOTDIR ? expandHome(env.ZDOTDIR, homeDir) : homeDir, '.zshrc');
    case 'bash':
      return path.join(homeDir, '.bashrc');
    case 'fish': {
      const config =
        env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME)
          ? env.XDG_CONFIG_HOME
          : path.join(homeDir, '.config');
      return path.join(config, 'fish', 'config.fish');
    }
    default:
      return null;
  }
}

export function hasLine(file: string, line: string): boolean {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .some((l) => l.trim() === line);
  } catch {
    return false;
  }
}

/**
 * Appends one line to the end of the file, once: nothing is written if the
 * line is there already, and nothing else in the file changes. Creates the
 * file (and fish's folder) if missing. Returns whether it wrote.
 */
export function appendLineOnce(file: string, line: string): boolean {
  if (hasLine(file, line)) return false;
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${separator}${line}\n`);
  return true;
}
