import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND, envVar } from '../shared/brand';
import { repoNameFromUrl } from '../shared/new-repository';
import { callApp, findBridge, type Output, stdio } from './bridge';

const USAGE = `usage: ${BRAND.cliCommand} add [path] [--profile <id>] [--name <name>] [--base <branch>]
       ${BRAND.cliCommand} add <folder> --all [--profile <id>]
       ${BRAND.cliCommand} add --new <path> [--no-readme] [--no-gitignore] [--profile <id>] [--name <name>]
       ${BRAND.cliCommand} add --clone <url> [path] [--profile <id>] [--name <name>] [--base <branch>]`;

/** Runs `git clone` in this terminal, its prompts included; resolves with git's exit code. */
export type Cloner = (url: string, dir: string, env: NodeJS.ProcessEnv) => Promise<number>;

const gitClone: Cloner = (url, dir, env) =>
  new Promise((resolve) => {
    const child = spawn('git', ['clone', '--', url, dir], { stdio: 'inherit', env });
    child.on('error', () => resolve(127));
    child.on('exit', (code) => resolve(code ?? 1));
  });

type Added = { id: string; profileId: string; repoPath: string; baseBranch: string };
const addedLine = (p: Added) =>
  `Added ${p.id} to ${p.profileId}: ${p.repoPath} (base ${p.baseBranch})\n`;

/**
 * `<slug> add` (spec §7.5): adds a repository as a project through the
 * running app; with `--all`, every repository one level down in a folder;
 * with `--new`, a new repository the app makes first; with `--clone`, a clone
 * made here first, by `git clone` in this terminal with its own environment.
 * Exit codes: 0 added (with --all: none refused), 1 refused or the clone
 * failed, 2 the app isn't running.
 */
export async function runAdd(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  { out, err }: Output = stdio,
  clone: Cloner = gitClone,
): Promise<number> {
  const options: Record<string, string> = {};
  const positional: string[] = [];
  let all = false;
  let create = false;
  let readme = true;
  let gitignore = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const flag = /^--(profile|name|base|clone)$/.exec(arg)?.[1];
    if (flag) {
      const value = args[++i];
      if (!value) {
        err(`${USAGE}\n`);
        return 1;
      }
      options[flag] = value;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--new') {
      create = true;
    } else if (arg === '--no-readme') {
      readme = false;
    } else if (arg === '--no-gitignore') {
      gitignore = false;
    } else if (arg === '--help' || arg === '-h') {
      out(`${USAGE}\n`);
      return 0;
    } else if (arg.startsWith('-')) {
      err(`unknown option ${arg}\n${USAGE}\n`);
      return 1;
    } else {
      positional.push(arg);
    }
  }
  const url = options.clone;
  const modes = [all, create, url !== undefined].filter(Boolean).length;
  if (positional.length > 1 || modes > 1 || (create && positional.length === 0)) {
    err(`${USAGE}\n`);
    return 1;
  }
  if ((!readme || !gitignore) && !create) {
    err(`--no-readme and --no-gitignore go with --new\n${USAGE}\n`);
    return 1;
  }

  let target = path.resolve(cwd, positional[0] ?? '.');
  if (url !== undefined) {
    const name = repoNameFromUrl(url);
    if (!positional[0] && !name) {
      err(`Can't tell a folder name from ${url}; give a path after it\n`);
      return 1;
    }
    target = path.resolve(cwd, positional[0] ?? name);
    // Nothing is cloned when it couldn't be added afterwards.
    if (!findBridge(env)) {
      err(`${BRAND.displayName} isn't running. Start it, then run this again.\n`);
      return 2;
    }
    if (!options.profile && !env[envVar('PROFILE')]) {
      err('Say which profile with --profile <id>\n');
      return 1;
    }
    const existing = fs.statSync(target, { throwIfNoEntry: false });
    if (existing && (!existing.isDirectory() || fs.readdirSync(target).length > 0)) {
      err(`${target} already exists and isn't empty\n`);
      return 1;
    }
    const code = await clone(url, target, env);
    if (code !== 0) {
      err(`git clone failed (exit ${code}); nothing was added\n`);
      return 1;
    }
  }

  const result = await callApp<
    | { ok: true; project: Added }
    | {
        ok: true;
        results: {
          repoPath: string;
          status: 'added' | 'already-added' | 'refused';
          project?: Added;
          error?: string;
        }[];
      }
    | { ok: false; error: string }
  >(
    env,
    '/add',
    {
      path: target,
      profileId: options.profile ?? null,
      name: options.name ?? null,
      base: options.base ?? null,
      terminalProfileId: env[envVar('PROFILE')] ?? null,
      all,
      create: create ? { readme, gitignore } : null,
    },
    all ? 300_000 : 30_000,
    { out, err },
  );
  if (result === 2) return 2;
  if (!result.ok) {
    err(`${result.error}\n`);
    return 1;
  }
  if ('project' in result) {
    out(addedLine(result.project));
    return 0;
  }
  let refused = 0;
  for (const line of result.results) {
    if (line.status === 'added' && line.project) out(addedLine(line.project));
    else if (line.status === 'already-added') out(`Skipped ${line.repoPath}: already added\n`);
    else {
      refused++;
      err(`Refused ${line.repoPath}: ${line.error ?? 'not added'}\n`);
    }
  }
  return refused > 0 ? 1 : 0;
}
