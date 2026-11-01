import type { Profile } from '@shared/schemas';
import type { ConfigStore } from '../config/store';
import { Git } from '../git/git';
import { buildProcessEnv } from './build-env';
import { type LoginShellEnv, resolveLoginShellEnv } from './login-shell';
import type { Env } from './scrub';
import { resolveExecutable } from './which';

/** Resolves the login-shell environment once per app run and answers lookups against it. */
export class EnvService {
  private loginEnv: Promise<LoginShellEnv>;

  constructor(
    private readonly config: ConfigStore,
    loginEnv: Promise<LoginShellEnv> = resolveLoginShellEnv(),
  ) {
    this.loginEnv = loginEnv;
  }

  login(): Promise<LoginShellEnv> {
    return this.loginEnv;
  }

  /**
   * Resolves the login-shell environment again, for example after the Claude
   * Code installer changed PATH (spec §6.11). Sessions already running keep
   * theirs.
   */
  refreshLogin(
    resolve: () => Promise<LoginShellEnv> = resolveLoginShellEnv,
  ): Promise<LoginShellEnv> {
    this.loginEnv = resolve();
    return this.loginEnv;
  }

  profile(profileId: string): Profile {
    const profile = this.config.require().profiles.find((p) => p.id === profileId);
    if (!profile) throw new Error(`Unknown profile "${profileId}"`);
    return profile;
  }

  /** Environment for processes run on behalf of a profile, outside any workspace. */
  async forProfile(profileId: string): Promise<Env> {
    const { env } = await this.loginEnv;
    return buildProcessEnv({ base: env, profile: this.profile(profileId) });
  }

  /** git, running with the profile's environment. */
  async git(profileId: string): Promise<Git> {
    const env = await this.forProfile(profileId);
    const gitPath = resolveExecutable('git', env);
    if (!gitPath) throw new Error('git was not found on the PATH of your login shell');
    return new Git({ gitPath, env });
  }

  /** Where `git` and each profile's Claude command resolve to, for showing setup problems. */
  async diagnostics() {
    const { env, shell, source, error } = await this.loginEnv;
    const profiles = this.config.get().config?.profiles ?? [];
    return {
      shell,
      source,
      error: error ?? null,
      git: resolveExecutable('git', env),
      profiles: profiles.map((profile) => ({
        profileId: profile.id,
        claude: resolveExecutable(profile.claude.command, buildProcessEnv({ base: env, profile })),
      })),
    };
  }
}
