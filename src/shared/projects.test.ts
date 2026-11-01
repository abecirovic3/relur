import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import { projectWorktreeDir } from './projects';

describe('projectWorktreeDir', () => {
  it('puts a project under its profile worktree root (spec §8.1)', () => {
    expect(projectWorktreeDir({ id: 'work', defaults: {} }, { id: 'api' })).toBe(
      `~/${BRAND.homeDirName}/worktrees/work/api`,
    );
    expect(
      projectWorktreeDir({ id: 'work', defaults: { worktreeRoot: '/w/' } }, { id: 'api' }),
    ).toBe('/w/api');
  });

  it('puts it in .worktrees/<project> of the folder the project chose', () => {
    const profile = { id: 'work', defaults: { worktreeRoot: '/w' } };
    expect(projectWorktreeDir(profile, { id: 'api', worktreeRoot: '~/Projects/' })).toBe(
      '~/Projects/.worktrees/api',
    );
    expect(projectWorktreeDir(profile, { id: 'api', worktreeRoot: null })).toBe('/w/api');
  });
});
