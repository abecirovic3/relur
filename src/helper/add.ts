import path from 'node:path';
import { BRAND, envVar } from '../shared/brand';
import { callApp, type Output, stdio } from './bridge';

const USAGE = `usage: ${BRAND.cliCommand} add [path] [--profile <id>] [--name <name>] [--base <branch>]
       ${BRAND.cliCommand} add <folder> --all [--profile <id>]`;

type Added = { id: string; profileId: string; repoPath: string; baseBranch: string };
const addedLine = (p: Added) =>
  `Added ${p.id} to ${p.profileId}: ${p.repoPath} (base ${p.baseBranch})\n`;

/**
 * `<slug> add` (spec §7.5): adds a repository as a project through the
 * running app; with `--all`, every repository one level down in a folder.
 * Exit codes: 0 added (with --all: none refused), 1 refused, 2 the app isn't
 * running.
 */
export async function runAdd(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  { out, err }: Output = stdio,
): Promise<number> {
  const options: Record<string, string> = {};
  const positional: string[] = [];
  let all = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    const flag = /^--(profile|name|base)$/.exec(arg)?.[1];
    if (flag) {
      const value = args[++i];
      if (!value) {
        err(`${USAGE}\n`);
        return 1;
      }
      options[flag] = value;
    } else if (arg === '--all') {
      all = true;
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
  if (positional.length > 1) {
    err(`${USAGE}\n`);
    return 1;
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
      path: path.resolve(cwd, positional[0] ?? '.'),
      profileId: options.profile ?? null,
      name: options.name ?? null,
      base: options.base ?? null,
      terminalProfileId: env[envVar('PROFILE')] ?? null,
      all,
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
