import { describe, expect, it } from 'vitest';
import { repoNameFromUrl, repoNameProblem } from './new-repository';

describe('repoNameProblem (spec §6.1)', () => {
  it('accepts ordinary names', () => {
    for (const name of ['shop', 'my-repo', 'repo.v2', 'Repo_1', 'two words', '.dotfiles']) {
      expect(repoNameProblem(name), name).toBeNull();
    }
  });

  it('refuses names that are not one usable folder name', () => {
    expect(repoNameProblem('')).toMatch(/Enter a name/);
    expect(repoNameProblem('   ')).toMatch(/Enter a name/);
    expect(repoNameProblem('.')).toMatch(/can't be a folder name/);
    expect(repoNameProblem('..')).toMatch(/can't be a folder name/);
    expect(repoNameProblem('a/b')).toMatch(/"\/"/);
    expect(repoNameProblem('a\\b')).toMatch(/"\/"/);
    expect(repoNameProblem('a\nb')).toMatch(/control characters/);
    expect(repoNameProblem('-rf')).toMatch(/start with "-"/);
    expect(repoNameProblem(' lead')).toMatch(/start with a space/);
    expect(repoNameProblem('trail ')).toMatch(/end with a space or a dot/);
    expect(repoNameProblem('trail.')).toMatch(/end with a space or a dot/);
    expect(repoNameProblem('x'.repeat(256))).toMatch(/too long/);
    // 255 bytes, not characters: "é" is two.
    expect(repoNameProblem('é'.repeat(128))).toMatch(/too long/);
    expect(repoNameProblem('x'.repeat(255))).toBeNull();
  });
});

describe('repoNameFromUrl (spec §6.1)', () => {
  it('takes the last path segment, as git clone does', () => {
    expect(repoNameFromUrl('git@host.example:team/shop.git')).toBe('shop');
    expect(repoNameFromUrl('https://host.example/team/shop')).toBe('shop');
    expect(repoNameFromUrl('https://host.example/team/shop.git/')).toBe('shop');
    expect(repoNameFromUrl('ssh://git@host.example:2222/team/api.git')).toBe('api');
    expect(repoNameFromUrl('/srv/git/tools.git')).toBe('tools');
    expect(repoNameFromUrl('file:///srv/git/tools')).toBe('tools');
    expect(repoNameFromUrl('host.example:shop.git')).toBe('shop');
    expect(repoNameFromUrl('  ../shop.git  ')).toBe('shop');
  });

  it('is empty when there is no name', () => {
    expect(repoNameFromUrl('')).toBe('');
    expect(repoNameFromUrl('/')).toBe('');
  });
});
