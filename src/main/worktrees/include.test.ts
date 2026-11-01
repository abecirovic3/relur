import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Git } from '../git/git';
import { createFixture, type Fixture } from '../test-support/git-fixtures';
import { copyIncludedFiles, includedFiles, includingPattern, parseIncludeFile } from './include';

let fx: Fixture;
let git: Git;

const write = (root: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
};

beforeAll(() => {
  fx = createFixture();
  git = new Git({ gitPath: 'git', env: fx.env });
});
afterAll(() => fx.cleanup());

describe('.worktreeinclude patterns (gitignore syntax)', () => {
  const included = (lines: string, rel: string) =>
    includingPattern(parseIncludeFile(lines), rel) !== null;

  it('matches a name at any depth, and anchors patterns with a slash', () => {
    expect(included('.env', '.env')).toBe(true);
    expect(included('.env', 'apps/web/.env')).toBe(true);
    expect(included('config/secrets.json', 'config/secrets.json')).toBe(true);
    expect(included('config/secrets.json', 'apps/config/secrets.json')).toBe(false);
    expect(included('/.env', 'apps/.env')).toBe(false);
  });

  it('supports *, ?, [..], ** and folders', () => {
    expect(included('*.pem', 'certs/dev.pem')).toBe(true);
    expect(included('cert?.pem', 'cert1.pem')).toBe(true);
    expect(included('.env.[ld]*', '.env.local')).toBe(true);
    expect(included('.env.[!l]*', '.env.local')).toBe(false);
    expect(included('vendor/**/config.json', 'vendor/a/b/config.json')).toBe(true);
    expect(included('secrets/', 'secrets/a/key')).toBe(true);
    expect(included('secrets/', 'secrets')).toBe(false);
    expect(included('# a comment\n\n', '# a comment')).toBe(false);
  });

  it('lets a later ! exclude again, but not inside an included folder', () => {
    expect(included('*.log\n!debug.log', 'debug.log')).toBe(false);
    expect(included('*.log\n!debug.log', 'other.log')).toBe(true);
    expect(included('logs/\n!logs/keep.txt', 'logs/keep.txt')).toBe(true);
  });
});

describe('includedFiles', () => {
  it('copies only gitignored files that match; ** reaches ignored folders as Claude Code does', async () => {
    const repo = fx.localRepo('include-repo');
    write(repo, {
      '.gitignore': '.env*\nnode_modules/\nconfig/secrets.json\n.claude/\nvendor/\n*.log\n',
      '.worktreeinclude':
        '.env\n.env.local\nconfig/secrets.json\n**/.claude/skills/*.md\n**/config.json\nREADME\n*.log\n!debug.log\n',
    });
    fx.git(repo, 'add', '.');
    fx.git(repo, 'commit', '-q', '-m', 'ignore rules');
    write(repo, {
      '.env': 'A=1\n',
      '.env.local': 'B=2\n',
      'sub/.env': 'C=3\n',
      'node_modules/pkg/.env': 'not this\n',
      'config/secrets.json': '{}\n',
      '.claude/skills/review.md': '# skill\n',
      'vendor/x/config.json': '{}\n',
      'debug.log': 'x\n',
      'build.log': 'x\n',
      'untracked.txt': 'not ignored\n',
    });
    expect(await includedFiles(git, repo)).toEqual([
      '.claude/skills/review.md',
      '.env',
      '.env.local',
      'build.log',
      'config/secrets.json',
      'sub/.env',
    ]);
    // Naming the ignored folder reaches into it.
    fs.appendFileSync(path.join(repo, '.worktreeinclude'), 'vendor/**/config.json\n');
    expect(await includedFiles(git, repo)).toContain('vendor/x/config.json');
  });

  it('copies them into the worktree as files, keeping modes, and keeps existing ones', async () => {
    const repo = fx.localRepo('copy-repo');
    write(repo, { '.gitignore': '.env\nbin/\n', '.worktreeinclude': '.env\nbin/\n' });
    fx.git(repo, 'add', '.');
    fx.git(repo, 'commit', '-q', '-m', 'rules');
    write(repo, { '.env': 'SECRET=1\n', 'bin/run': '#!/bin/sh\n' });
    fs.chmodSync(path.join(repo, 'bin/run'), 0o755);
    const worktree = path.join(fx.root, 'copy-wt');
    fx.git(repo, 'worktree', 'add', '-q', '-b', 'wt', worktree);
    write(worktree, { 'bin/run': 'mine\n' });
    expect(await copyIncludedFiles(git, repo, worktree)).toEqual(['.env']);
    expect(fs.lstatSync(path.join(worktree, '.env')).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(worktree, '.env'), 'utf8')).toBe('SECRET=1\n');
    expect(fs.readFileSync(path.join(worktree, 'bin/run'), 'utf8')).toBe('mine\n');
    fs.rmSync(path.join(worktree, 'bin/run'));
    fs.rmSync(path.join(worktree, '.env'));
    await copyIncludedFiles(git, repo, worktree);
    expect(fs.statSync(path.join(worktree, 'bin/run')).mode & 0o777).toBe(0o755);
  });

  it('copies nothing without a .worktreeinclude', async () => {
    const repo = fx.localRepo('no-include');
    write(repo, { '.gitignore': '.env\n', '.env': 'x' });
    expect(await includedFiles(git, repo)).toEqual([]);
  });
});
