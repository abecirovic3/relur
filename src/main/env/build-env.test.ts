import { envVar } from '@shared/brand';
import { type Profile, ProfileSchema, type Project, ProjectSchema } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import { buildProcessEnv } from './build-env';

const base = {
  PATH: '/usr/bin',
  HOME: '/home/u',
  ANTHROPIC_API_KEY: 'sk-from-shell',
  ANTHROPIC_AUTH_TOKEN: 'tok',
  CLAUDE_CONFIG_DIR: '/home/u/.claude-from-zshrc',
};
const profile = (overrides: Partial<Profile> = {}): Profile =>
  ProfileSchema.parse({ id: 'work', name: 'Work', ...overrides });
const project = (overrides: Partial<Project> = {}): Project =>
  ProjectSchema.parse({ id: 'api', profileId: 'work', name: 'api', repoPath: '/r', ...overrides });

describe('buildProcessEnv', () => {
  it('strips credentials and account selection from the shell environment (R4)', () => {
    const env = buildProcessEnv({ base, profile: profile(), homeDir: '/home/u' });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(env).not.toHaveProperty('CLAUDE_CONFIG_DIR');
    expect(env.PATH).toBe('/usr/bin');
    expect(env[envVar('PROFILE')]).toBe('work');
  });

  it('applies the profile env, expanding ~, including explicit credentials', () => {
    const env = buildProcessEnv({
      base,
      profile: profile({
        id: 'personal',
        env: { CLAUDE_CONFIG_DIR: '~/.claude-personal', ANTHROPIC_API_KEY: 'sk-profile' },
      }),
      homeDir: '/home/u',
    });
    expect(env.CLAUDE_CONFIG_DIR).toBe('/home/u/.claude-personal');
    expect(env.ANTHROPIC_API_KEY).toBe('sk-profile');
    expect(env[envVar('PROFILE')]).toBe('personal');
  });

  it('adds workspace variables that the profile env cannot override', () => {
    const env = buildProcessEnv({
      base,
      profile: profile({ env: { [envVar('BRANCH')]: 'spoofed' } }),
      workspace: {
        id: 'ws_1',
        name: 'Fix login',
        rootPath: '/r',
        worktreePath: '/w',
        branch: 'fix-login',
        baseBranch: 'main',
        task: { title: 'Fix login' },
      },
    });
    expect(env[envVar('WORKSPACE_ID')]).toBe('ws_1');
    expect(env[envVar('WORKTREE_PATH')]).toBe('/w');
    expect(env[envVar('ROOT_PATH')]).toBe('/r');
    expect(env[envVar('BRANCH')]).toBe('fix-login');
    expect(env[envVar('BASE_BRANCH')]).toBe('main');
    expect(env[envVar('TASK_TITLE')]).toBe('Fix login');
    expect(env[envVar('TASK_ID')]).toBe('');
    expect(env[envVar('TASK_URL')]).toBe('');
  });

  it('sets the commit identity, project over profile, only when configured', () => {
    const none = buildProcessEnv({ base, profile: profile() });
    expect(none).not.toHaveProperty('GIT_AUTHOR_NAME');

    const fromProfile = buildProcessEnv({
      base,
      profile: profile({ git: { commitName: 'P', commitEmail: 'p@x' } }),
      project: project(),
    });
    expect(fromProfile.GIT_AUTHOR_EMAIL).toBe('p@x');
    expect(fromProfile.GIT_COMMITTER_NAME).toBe('P');

    const fromProject = buildProcessEnv({
      base,
      profile: profile({ git: { commitName: 'P', commitEmail: 'p@x' } }),
      project: project({ git: { commitName: 'Q', commitEmail: 'q@x' } }),
    });
    expect(fromProject.GIT_AUTHOR_NAME).toBe('Q');
    expect(fromProject.GIT_COMMITTER_EMAIL).toBe('q@x');
  });
});
