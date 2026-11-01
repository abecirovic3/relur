import { execFile } from 'node:child_process';
import path from 'node:path';
import type { Env } from '../env/scrub';

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(stderr.trim() || `git ${args.join(' ')} failed with exit code ${exitCode}`);
    this.name = 'GitError';
  }
}

/** A changed file (spec §6.4). `R` is a rename from `oldPath`. */
export interface DiffFile {
  kind: 'M' | 'A' | 'D' | 'R';
  path: string;
  oldPath: string | null;
  added: number;
  removed: number;
  binary: boolean;
}

/** One entry of `git worktree list --porcelain`. */
export interface GitWorktree {
  path: string;
  head: string | null;
  /** The checked-out branch, without `refs/heads/`; null when detached. */
  branch: string | null;
  bare: boolean;
  /** Its folder is gone; `git worktree prune` would forget it. */
  prunable: boolean;
}

/** Parses `git worktree list --porcelain`: blocks of lines, separated by blank lines. */
export function parseWorktreeList(out: string): GitWorktree[] {
  return out
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').filter(Boolean))
    .filter((lines) => lines[0]?.startsWith('worktree '))
    .map((lines) => {
      const value = (key: string) =>
        lines.find((l) => l === key || l.startsWith(`${key} `))?.slice(key.length + 1) ?? null;
      const branch = value('branch');
      return {
        path: value('worktree') as string,
        head: value('HEAD'),
        branch: branch ? branch.replace(/^refs\/heads\//, '') : null,
        bare: lines.includes('bare'),
        prunable: lines.some((l) => l === 'prunable' || l.startsWith('prunable ')),
      };
    });
}

export interface GitOptions {
  /** Absolute path of the git executable. */
  gitPath: string;
  /** Environment of the profile the command runs for (rule R3). */
  env: Env;
}

/**
 * Thin wrapper around the git CLI (spec §16): behaviour matches the user's own
 * git config, credentials and hooks. Never prompts; a command that would ask
 * for credentials fails instead.
 */
export class Git {
  constructor(private readonly options: GitOptions) {}

  run(cwd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        this.options.gitPath,
        args,
        {
          cwd,
          env: { ...this.options.env, GIT_TERMINAL_PROMPT: '0' },
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            const code = typeof error.code === 'number' ? error.code : null;
            reject(new GitError(args, code, stderr || error.message));
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  /** Like `run`, but returns null instead of throwing when git exits non-zero. */
  async tryRun(cwd: string, args: string[]): Promise<string | null> {
    try {
      return await this.run(cwd, args);
    } catch (error) {
      if (error instanceof GitError && error.exitCode !== null) return null;
      throw error;
    }
  }

  /**
   * The main checkout of the repository containing `dir`. For a linked
   * worktree this is the checkout it was created from, not the worktree.
   */
  async mainCheckout(dir: string): Promise<string> {
    const out = await this.run(dir, [
      'rev-parse',
      '--path-format=absolute',
      '--is-bare-repository',
      '--git-common-dir',
    ]);
    const [isBare, commonDir] = out.trim().split('\n');
    if (isBare === 'true' || !commonDir) {
      throw new GitError(['rev-parse'], 1, `${dir} is a bare repository; pick a checkout`);
    }
    if (path.basename(commonDir) !== '.git') {
      // A separate git dir (`git init --separate-git-dir`) has no checkout to derive.
      return (await this.run(dir, ['rev-parse', '--show-toplevel'])).trim();
    }
    return path.dirname(commonDir);
  }

  async remotes(repo: string): Promise<string[]> {
    return (await this.run(repo, ['remote'])).split('\n').filter(Boolean);
  }

  /** Default branch of a remote from `<remote>/HEAD`, or null if unknown locally. */
  async remoteDefaultBranch(repo: string, remote: string): Promise<string | null> {
    const ref = await this.tryRun(repo, [
      'symbolic-ref',
      '--quiet',
      '--short',
      `refs/remotes/${remote}/HEAD`,
    ]);
    const name = ref?.trim();
    return name?.startsWith(`${remote}/`) ? name.slice(remote.length + 1) : null;
  }

  /** The checked-out branch, or null on a detached HEAD. */
  async currentBranch(repo: string): Promise<string | null> {
    return (
      (await this.tryRun(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']))?.trim() || null
    );
  }

  /** Whether `name` is a valid branch name (`git check-ref-format --branch`). */
  async isValidBranchName(cwd: string, name: string): Promise<boolean> {
    if (!name || name.startsWith('-')) return false;
    return (await this.tryRun(cwd, ['check-ref-format', '--branch', name])) !== null;
  }

  async localBranchExists(repo: string, branch: string): Promise<boolean> {
    const out = await this.tryRun(repo, [
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ]);
    return out !== null;
  }

  /** Whether the remote-tracking ref exists locally (as of the last fetch). */
  async trackingBranchExists(repo: string, remote: string, branch: string): Promise<boolean> {
    const ref = `refs/remotes/${remote}/${branch}`;
    return (await this.tryRun(repo, ['rev-parse', '--verify', '--quiet', ref])) !== null;
  }

  /** Asks the remote itself whether it has the branch (network). */
  async remoteBranchExists(repo: string, remote: string, branch: string): Promise<boolean> {
    try {
      await this.run(repo, ['ls-remote', '--exit-code', '--heads', remote, `refs/heads/${branch}`]);
      return true;
    } catch (error) {
      // Exit code 2: the remote answered and has no such branch.
      if (error instanceof GitError && error.exitCode === 2) return false;
      throw error;
    }
  }

  /** Branch names of a remote's tracking refs, e.g. `develop` for `origin/develop`. */
  async remoteBranches(repo: string, remote: string): Promise<string[]> {
    const out = await this.run(repo, [
      'for-each-ref',
      '--format=%(refname:lstrip=3)',
      `refs/remotes/${remote}`,
    ]);
    return out.split('\n').filter((b) => b && b !== 'HEAD');
  }

  async localBranches(repo: string): Promise<string[]> {
    const out = await this.run(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    return out.split('\n').filter(Boolean);
  }

  async fetch(repo: string, remote: string, branch: string): Promise<void> {
    await this.run(repo, ['fetch', '--quiet', remote, branch]);
  }

  /**
   * New branch and worktree at `dir` from `startPoint`. `--no-track`: the
   * branch must not push to its base by accident.
   */
  async addWorktree(repo: string, dir: string, branch: string, startPoint: string): Promise<void> {
    await this.run(repo, [
      'worktree',
      'add',
      '--quiet',
      '--no-track',
      '-b',
      branch,
      dir,
      startPoint,
    ]);
  }

  /** The repository's shared git dir (`.git` of the main checkout), absolute. */
  async commonDir(dir: string): Promise<string> {
    const out = await this.run(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    return out.trim();
  }

  /** `git status --porcelain` lines: uncommitted and untracked changes. */
  async status(dir: string): Promise<string[]> {
    const out = await this.run(dir, ['status', '--porcelain=v1', '--untracked-files=all']);
    return out.split('\n').filter(Boolean);
  }

  /**
   * Commits on `branch` that would be lost with it: not on any remote-tracking
   * branch, or, for a repository without remotes, not on any other local branch.
   */
  async unpushedCount(repo: string, branch: string, hasRemote: boolean): Promise<number> {
    const others = hasRemote
      ? ['--remotes']
      : (await this.localBranches(repo)).filter((b) => b !== branch).map((b) => `refs/heads/${b}`);
    const out = await this.run(repo, [
      'rev-list',
      '--count',
      `refs/heads/${branch}`,
      '--not',
      ...others,
    ]);
    return Number(out.trim());
  }

  async removeWorktree(repo: string, dir: string, force: boolean): Promise<void> {
    await this.run(repo, ['worktree', 'remove', ...(force ? ['--force', '--force'] : []), dir]);
  }

  /** The repository's worktrees (`git worktree list --porcelain`), the main checkout first. */
  async listWorktrees(repo: string): Promise<GitWorktree[]> {
    return parseWorktreeList(await this.run(repo, ['worktree', 'list', '--porcelain']));
  }

  /** Forgets worktrees whose folders are gone. */
  async pruneWorktrees(repo: string): Promise<void> {
    await this.run(repo, ['worktree', 'prune']);
  }

  /** The best common ancestor of two commits, or null when they share none. */
  async mergeBase(dir: string, a: string, b: string): Promise<string | null> {
    return (await this.tryRun(dir, ['merge-base', a, b]))?.trim() || null;
  }

  async revParse(dir: string, rev: string): Promise<string | null> {
    return (await this.tryRun(dir, ['rev-parse', '--verify', '--quiet', rev]))?.trim() || null;
  }

  /**
   * Changed files between `from` and `to` (or the working tree when `to` is
   * null), with renames: kind, path, old path, and added/removed line counts
   * (null for binary files).
   */
  async diffFiles(dir: string, from: string, to: string | null): Promise<DiffFile[]> {
    const range = to ? [from, to] : [from];
    const [status, numstat] = await Promise.all([
      this.run(dir, ['diff', '-z', '-M', '--name-status', ...range, '--']),
      this.run(dir, ['diff', '-z', '-M', '--numstat', ...range, '--']),
    ]);
    const files: DiffFile[] = [];
    const s = status.split('\0');
    for (let i = 0; i + 1 < s.length; ) {
      const code = s[i++] as string;
      if (!code) continue;
      const kind = code[0] as string;
      if (kind === 'R' || kind === 'C') {
        const oldPath = s[i++] as string;
        files.push({
          kind: kind === 'R' ? 'R' : 'A',
          path: s[i++] as string,
          oldPath,
          added: 0,
          removed: 0,
          binary: false,
        });
      } else {
        files.push({
          kind: kind === 'D' ? 'D' : kind === 'A' ? 'A' : 'M',
          path: s[i++] as string,
          oldPath: null,
          added: 0,
          removed: 0,
          binary: false,
        });
      }
    }
    // numstat: "add\tdel\tpath\0", or for renames "add\tdel\t\0old\0new\0".
    const n = numstat.split('\0');
    for (let i = 0; i < n.length; ) {
      const head = n[i++] as string;
      if (!head) continue;
      const [add, del, rest] = head.split('\t') as [string, string, string];
      let filePath = rest;
      if (rest === '') {
        i++; // the old path of a rename
        filePath = n[i++] as string;
      }
      const file = files.find((f) => f.path === filePath);
      if (!file) continue;
      file.binary = add === '-';
      file.added = file.binary ? 0 : Number(add);
      file.removed = file.binary ? 0 : Number(del);
    }
    return files;
  }

  /** Untracked files that aren't ignored, relative to `dir`. */
  async untrackedFiles(dir: string): Promise<string[]> {
    const out = await this.run(dir, ['ls-files', '-z', '--others', '--exclude-standard']);
    return out.split('\0').filter(Boolean);
  }

  /** A file's content at a revision, or null when it doesn't exist there. */
  async showFile(dir: string, rev: string, file: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      execFile(
        this.options.gitPath,
        ['show', `${rev}:${file}`],
        {
          cwd: dir,
          env: { ...this.options.env, GIT_TERMINAL_PROMPT: '0' },
          encoding: 'buffer',
          maxBuffer: 64 * 1024 * 1024,
        },
        (error, stdout) => resolve(error ? null : stdout),
      );
    });
  }

  /** Deletes a local branch; remote branches are never touched. */
  async deleteBranch(repo: string, branch: string): Promise<void> {
    await this.run(repo, ['branch', '--quiet', '-D', branch]);
  }
}
