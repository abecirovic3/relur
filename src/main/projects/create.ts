import fs from 'node:fs';
import path from 'node:path';
import type { Git } from '../git/git';

/** The first commit's message for a new repository (spec §6.1). */
export const FIRST_COMMIT_MESSAGE = 'Initial commit';

/** The `.gitignore` a new repository starts with, when ticked (spec §6.1). */
export const NEW_REPO_GITIGNORE = '.DS_Store\n.env\n.env.*\n';

/**
 * Why `dir` can't receive a new repository or a clone, or null: it must not
 * exist, or be an empty folder (spec §6.1).
 */
export function targetProblem(dir: string): string | null {
  const stat = fs.statSync(dir, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isDirectory()) return `${dir} exists and isn't a folder`;
  if (fs.readdirSync(dir).length > 0) return `${dir} already exists and isn't empty`;
  return null;
}

/** The repository whose working tree holds `dir`, or null (a warning, spec §6.1). */
export async function enclosingRepository(git: Git, dir: string): Promise<string | null> {
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return null;
  const top = await git.tryRun(dir, ['rev-parse', '--show-toplevel']).catch(() => null);
  return top?.trim() || null;
}

export interface NewRepositoryOptions {
  /** The repository's name: the README's heading. */
  name: string;
  baseBranch: string;
  readme: boolean;
  gitignore: boolean;
}

/**
 * Makes a new repository at `dir` (spec §6.1): the folder, `git init` on the
 * base branch, then a first commit, with a README and `.gitignore` when
 * asked, otherwise empty. The commit identity is the profile's, from the
 * environment `git` runs with. The checks are the caller's. When a step
 * fails, what it made is removed again.
 */
export async function createRepository(
  git: Git,
  dir: string,
  options: NewRepositoryOptions,
): Promise<void> {
  if (!(await git.isValidBranchName(path.dirname(dir), options.baseBranch))) {
    throw new Error(`"${options.baseBranch}" isn't a valid branch name`);
  }
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  try {
    await initAndCommit(git, dir, options);
  } catch (error) {
    // The folder was empty or new: everything in it is ours.
    for (const entry of fs.readdirSync(dir)) {
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
    if (!existed) fs.rmdirSync(dir);
    const text = error instanceof Error ? error.message : String(error);
    if (/Please tell me who you are|identity unknown/i.test(text)) {
      throw new Error(
        "git doesn't know who you are: set the commit identity in Edit profile, or user.name and user.email in your git config",
      );
    }
    throw error;
  }
}

async function initAndCommit(git: Git, dir: string, options: NewRepositoryOptions): Promise<void> {
  await git.run(dir, ['init', '--quiet']);
  // `init -b` needs git 2.28; pointing HEAD works everywhere.
  await git.run(dir, ['symbolic-ref', 'HEAD', `refs/heads/${options.baseBranch}`]);
  const files: string[] = [];
  if (options.readme) {
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${options.name}\n`);
    files.push('README.md');
  }
  if (options.gitignore) {
    fs.writeFileSync(path.join(dir, '.gitignore'), NEW_REPO_GITIGNORE);
    files.push('.gitignore');
  }
  if (files.length > 0) await git.run(dir, ['add', '--', ...files]);
  await git.run(dir, [
    'commit',
    '--quiet',
    '--no-verify',
    ...(files.length === 0 ? ['--allow-empty'] : []),
    '-m',
    FIRST_COMMIT_MESSAGE,
  ]);
}
