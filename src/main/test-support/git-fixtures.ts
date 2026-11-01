import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Environment that isolates test repositories from the user's git config. */
export function gitTestEnv(home: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
}

export interface Fixture {
  root: string;
  env: Record<string, string>;
  git(cwd: string, ...args: string[]): string;
  /** A bare "remote" whose default branch is `defaultBranch`, plus a clone of it. */
  cloneWithRemote(name: string, defaultBranch?: string): { origin: string; clone: string };
  /** A repository with one commit and no remotes. */
  localRepo(name: string, branch?: string): string;
  cleanup(): void;
}

export function createFixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'git-fixture-')));
  const env = gitTestEnv(root);
  fs.writeFileSync(env.GIT_CONFIG_GLOBAL as string, '');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' });

  const localRepo = (name: string, branch = 'main') => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', branch);
    fs.writeFileSync(path.join(dir, 'README'), 'hello\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'initial');
    return dir;
  };

  return {
    root,
    env,
    git,
    localRepo,
    cloneWithRemote(name, defaultBranch = 'main') {
      const seed = localRepo(`${name}-seed`, defaultBranch);
      const origin = path.join(root, `${name}-origin.git`);
      git(root, 'clone', '-q', '--bare', seed, origin);
      const clone = path.join(root, name);
      git(root, 'clone', '-q', origin, clone);
      return { origin, clone };
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
