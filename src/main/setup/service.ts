import { EventEmitter } from 'node:events';
import {
  accountFolder,
  INSTALL_METHODS,
  type InstallMethod,
  type SetupCheck,
  type SetupSession,
  setupPassed,
  signInCommand,
} from '@shared/setup';
import type { SessionInfo } from '@shared/terminal-protocol';
import type { ConfigStore } from '../config/store';
import type { EnvService } from '../env/service';
import { resolveExecutable } from '../env/which';
import type { TerminalService } from '../services/terminals';
import { runSetupCheck } from './check';

/** Focus re-checks are skipped this soon after the last one. */
const FOCUS_INTERVAL_MS = 3000;

/**
 * Setup check results per profile (spec §6.11). Each profile runs one check at
 * a time; asking again while it runs returns the running one.
 */
export class SetupService {
  private readonly results = new Map<string, SetupCheck>();
  private readonly running = new Map<string, Promise<SetupCheck>>();
  /** The latest install or sign-in session per profile. */
  private readonly sessions = new Map<string, SetupSession>();
  private readonly events = new EventEmitter();
  private lastFocusCheck = 0;

  constructor(
    private readonly config: ConfigStore,
    private readonly env: EnvService,
    /** Runs install and sign-in commands; null where they aren't needed (tests). */
    private readonly terminals: TerminalService | null,
    private readonly timeouts?: { versionMs?: number; statusMs?: number },
  ) {
    // A removed profile's result goes with it; a changed folder needs a new check.
    config.onChange(({ config: current }) => {
      if (!current) return;
      for (const [profileId, result] of this.results) {
        const profile = current.profiles.find((p) => p.id === profileId);
        if (!profile) this.results.delete(profileId);
        else if (accountFolder(profile) !== result.folder) this.background(profileId);
      }
    });
  }

  /** The last result, starting the first check if there is none. */
  get(profileId: string): SetupCheck | null {
    const result = this.results.get(profileId);
    if (!result && !this.running.has(profileId)) this.background(profileId);
    return result ?? null;
  }

  /**
   * The official install methods available here; Homebrew only on macOS (its
   * casks don't exist on Linux) and when brew is on PATH.
   */
  async installMethods(): Promise<InstallMethod[]> {
    // TODO(M7): Windows methods.
    if (process.platform !== 'darwin' && process.platform !== 'linux') return [];
    const { env } = await this.env.login();
    return INSTALL_METHODS.filter(
      (m) => m.id !== 'brew' || (process.platform === 'darwin' && resolveExecutable('brew', env)),
    );
  }

  /** Runs an official installer in a visible terminal, after the user clicked Install. */
  async install(profileId: string, methodId: InstallMethod['id']): Promise<SessionInfo> {
    const method = (await this.installMethods()).find((m) => m.id === methodId);
    if (!method) throw new Error("This install method isn't available here");
    // The installers install for the user; never as root.
    if (process.getuid?.() === 0) throw new Error("Claude Code isn't installed as root");
    return this.startSession(profileId, 'install', 'Install Claude Code', method.command);
  }

  /** Runs `claude auth login` with the profile's environment in a visible terminal. */
  signIn(profileId: string): Promise<SessionInfo> {
    const profile = this.env.profile(profileId);
    return this.startSession(
      profileId,
      'sign-in',
      'Sign in',
      signInCommand(profile.claude.command),
    );
  }

  private async startSession(
    profileId: string,
    step: SetupSession['step'],
    title: string,
    command: string,
  ): Promise<SessionInfo> {
    if (!this.terminals) throw new Error('Setup commands are not available');
    const { host } = this.terminals;
    const previous = this.sessions.get(profileId);
    if (previous && host.has(previous.sessionId)) {
      if (host.get(previous.sessionId).status === 'running') {
        throw new Error('A setup command is still running');
      }
      await host.remove(previous.sessionId);
    }
    const session = await this.terminals.setupSession(profileId, title, command);
    this.sessions.set(profileId, { sessionId: session.id, step, command });
    const result = this.results.get(profileId);
    if (result) this.store(result);

    void host
      .waitForExit(session.id)
      .then(async () => {
        // The installer changes PATH in the shell's startup files.
        if (step === 'install') await this.env.refreshLogin();
        // A check that started before the exit may have used the old PATH or login.
        await this.running.get(profileId)?.catch(() => {});
        await this.check(profileId);
      })
      .catch(() => {});
    return session;
  }

  /** Every profile's last result, by profile id; starts the first check of any without one. */
  all(): Record<string, SetupCheck | null> {
    const out: Record<string, SetupCheck | null> = {};
    for (const profile of this.config.get().config?.profiles ?? []) {
      out[profile.id] = this.get(profile.id);
    }
    return out;
  }

  passed(profileId: string): boolean {
    return setupPassed(this.results.get(profileId));
  }

  /** The Claude gate (spec §6.11): Claude starts only in a profile whose check passed. */
  async refusal(profileId: string): Promise<string | null> {
    const running = this.running.get(profileId);
    if (running) await running.catch(() => {});
    else if (!this.results.has(profileId)) await this.check(profileId).catch(() => {});
    if (this.passed(profileId)) return null;
    return `Finish setting up ${this.env.profile(profileId).name} first: open its setup check`;
  }

  startFailed(profileId: string): void {
    this.background(profileId);
  }

  /** Checks every profile once, at startup. */
  checkAll(): void {
    for (const profile of this.config.get().config?.profiles ?? []) this.background(profile.id);
  }

  /** Runs the check now, or joins the one already running. */
  check(profileId: string): Promise<SetupCheck> {
    const existing = this.running.get(profileId);
    if (existing) return existing;
    const started = (async () => {
      const profile = this.env.profile(profileId);
      const env = await this.env.forProfile(profileId);
      const previous = this.results.get(profileId);
      return runSetupCheck({
        profileId,
        folder: accountFolder(profile),
        command: profile.claude.command,
        env,
        timeouts: this.timeouts,
        // Rows update as they run; the last complete time and verdict stay until this one ends.
        onProgress: (partial) =>
          this.store(
            partial.running
              ? {
                  ...partial,
                  checkedAt: previous?.checkedAt ?? null,
                  passed: previous?.passed ?? false,
                }
              : partial,
          ),
      });
    })().finally(() => this.running.delete(profileId));
    this.running.set(profileId, started);
    return started;
  }

  /**
   * When the window gains focus: re-checks only profiles that haven't passed,
   * so a working profile doesn't start claude on every focus.
   */
  checkUnpassedOnFocus(): void {
    const now = Date.now();
    if (now - this.lastFocusCheck < FOCUS_INTERVAL_MS) return;
    this.lastFocusCheck = now;
    for (const profile of this.config.get().config?.profiles ?? []) {
      if (!this.passed(profile.id)) this.background(profile.id);
    }
  }

  /** A check nobody waits for; a profile removed meanwhile just has no result. */
  private background(profileId: string): void {
    this.check(profileId).catch(() => {});
  }

  /** Emits the profile id whenever its result changes. */
  onChange(listener: (profileId: string) => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  private store(result: SetupCheck): void {
    // A profile removed while its check ran.
    if (!this.config.get().config?.profiles.some((p) => p.id === result.profileId)) return;
    this.results.set(result.profileId, {
      ...result,
      session: this.sessions.get(result.profileId) ?? null,
    });
    this.events.emit('change', result.profileId);
  }
}
