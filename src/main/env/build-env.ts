import { envVar } from '@shared/brand';
import type { Profile, Project } from '@shared/schemas';
import { expandHome } from '../paths';
import type { Env } from './scrub';

/** Rule R4: removed unless the profile sets them, so a subscription never bills an API key. */
export const CREDENTIAL_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'];
/** Selects the Claude account; only the profile may set it (rule G2). */
export const ACCOUNT_VARS = ['CLAUDE_CONFIG_DIR'];

export interface WorkspaceEnvInfo {
  id: string;
  name: string;
  rootPath: string;
  worktreePath: string;
  /** Worktrees of its linked repositories (spec §21.3). */
  linkedWorktrees?: string[];
  branch: string;
  baseBranch: string;
  task?: { id?: string; title?: string; url?: string };
  /** Its port block (spec §8.4). */
  ports?: { base: number; count: number } | null;
}

interface Input {
  /** The login-shell environment. */
  base: Env;
  profile: Profile;
  project?: Project;
  workspace?: WorkspaceEnvInfo;
  homeDir?: string;
}

/**
 * Environment for every process the app starts (spec §9.2, rule R3): login
 * shell environment, minus credentials and account selection, plus the
 * profile's env, plus the app's own variables.
 */
export function buildProcessEnv({ base, profile, project, workspace, homeDir }: Input): Env {
  const env: Env = { ...base };
  for (const key of [...CREDENTIAL_VARS, ...ACCOUNT_VARS]) delete env[key];

  for (const [key, value] of Object.entries(profile.env)) {
    env[key] = expandHome(value, homeDir);
  }

  env[envVar('PROFILE')] = profile.id;
  if (workspace) {
    Object.assign(env, {
      [envVar('WORKSPACE_ID')]: workspace.id,
      [envVar('WORKSPACE_NAME')]: workspace.name,
      [envVar('ROOT_PATH')]: workspace.rootPath,
      [envVar('WORKTREE_PATH')]: workspace.worktreePath,
      [envVar('LINKED_WORKTREES')]: (workspace.linkedWorktrees ?? []).join(':'),
      [envVar('BRANCH')]: workspace.branch,
      [envVar('BASE_BRANCH')]: workspace.baseBranch,
      [envVar('TASK_ID')]: workspace.task?.id ?? '',
      [envVar('TASK_TITLE')]: workspace.task?.title ?? '',
      [envVar('TASK_URL')]: workspace.task?.url ?? '',
    });
    if (workspace.ports) {
      env[envVar('PORT')] = String(workspace.ports.base);
      env[envVar('PORT_BASE')] = String(workspace.ports.base);
      env[envVar('PORT_COUNT')] = String(workspace.ports.count);
    }
  }

  // Commit identity: project overrides profile (spec §4.3).
  const identity = project?.git ?? profile.git;
  if (identity) {
    env.GIT_AUTHOR_NAME = identity.commitName;
    env.GIT_COMMITTER_NAME = identity.commitName;
    env.GIT_AUTHOR_EMAIL = identity.commitEmail;
    env.GIT_COMMITTER_EMAIL = identity.commitEmail;
  }
  return env;
}
