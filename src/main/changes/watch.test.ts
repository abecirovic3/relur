import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { ignoredChange, watchWorktrees, worktreeGitDir } from './watch';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts reports from watching `worktrees` while `act` runs. */
async function reports(worktrees: string[], act: () => void): Promise<number> {
  let count = 0;
  const close = watchWorktrees(worktrees, () => count++);
  try {
    // Native watchers start asynchronously; changes made at once can be missed.
    await settle(200);
    act();
    await settle(1200);
    return count;
  } finally {
    close();
  }
}

describe('watchWorktrees', () => {
  let fx: Fixture;
  let repo: string;
  let worktree: string;

  beforeAll(() => {
    fx = createFixture();
    repo = fx.localRepo('app');
    worktree = path.join(fx.root, 'wt');
    fx.git(repo, 'worktree', 'add', '-q', '-b', 'feat', worktree);
    fs.mkdirSync(path.join(worktree, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(worktree, 'src'));
  });
  afterAll(() => fx.cleanup());

  it('skips git internals and installed dependencies', () => {
    expect(ignoredChange('src/a.ts')).toBe(false);
    expect(ignoredChange('.git')).toBe(true);
    expect(ignoredChange('node_modules/pkg/index.js')).toBe(true);
    expect(ignoredChange('web/node_modules/x')).toBe(true);
  });

  it("finds a worktree's own git dir", () => {
    expect(worktreeGitDir(repo)).toBe(path.join(repo, '.git'));
    expect(fs.realpathSync(worktreeGitDir(worktree) as string)).toBe(
      fs.realpathSync(path.join(repo, '.git', 'worktrees', 'wt')),
    );
    expect(worktreeGitDir(fx.root)).toBeNull();
  });

  it('reports a burst of file changes once', async () => {
    const count = await reports([worktree], () => {
      fs.writeFileSync(path.join(worktree, 'a.txt'), 'a\n');
      fs.writeFileSync(path.join(worktree, 'src', 'b.ts'), 'b\n');
    });
    expect(count).toBe(1);
  });

  it('reports files in new folders', async () => {
    fs.mkdirSync(path.join(worktree, 'lib'));
    await settle(100);
    const count = await reports([worktree], () => {
      fs.mkdirSync(path.join(worktree, 'lib', 'deep'));
      fs.writeFileSync(path.join(worktree, 'lib', 'deep', 'c.ts'), 'c\n');
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('ignores changes in node_modules', async () => {
    const count = await reports([worktree], () => {
      fs.writeFileSync(path.join(worktree, 'node_modules', 'pkg', 'index.js'), 'x\n');
    });
    expect(count).toBe(0);
  });

  it('reports staging and commits made from the shell', async () => {
    fs.writeFileSync(path.join(worktree, 'd.txt'), 'd\n');
    await settle(100);
    const count = await reports([worktree], () => {
      fx.git(worktree, 'add', 'd.txt');
      fx.git(worktree, 'commit', '-q', '-m', 'd');
    });
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('stops reporting once closed', async () => {
    let count = 0;
    const close = watchWorktrees([worktree], () => count++);
    close();
    fs.writeFileSync(path.join(worktree, 'e.txt'), 'e\n');
    await settle(600);
    expect(count).toBe(0);
  });

  it('checks every few seconds instead when the OS has no watches left (inotify limit)', async () => {
    const spy = vi.spyOn(fs, 'watch').mockImplementation(() => {
      throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
    });
    let count = 0;
    let limits = 0;
    const close = watchWorktrees(
      [worktree],
      () => count++,
      () => limits++,
      50,
    );
    try {
      await settle(400);
      expect(limits).toBe(1);
      expect(count).toBeGreaterThanOrEqual(3);
    } finally {
      close();
      spy.mockRestore();
    }
    const after = count;
    await settle(200);
    expect(count).toBe(after);
  });
});
