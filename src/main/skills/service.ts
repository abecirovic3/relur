import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { uniqueSlug } from '@shared/profiles';
import type { Project, SkillSource } from '@shared/schemas';
import {
  type SourceCommit,
  type SourceInspection,
  type SourceUpdate,
  sourceApplies,
} from '@shared/skills';
import type { ConfigStore } from '../config/store';
import type { EnvService } from '../env/service';
import { type Git, GitError } from '../git/git';
import { expandHome } from '../paths';
import { detectSource, ensureWrapper, sourcePlugins } from './sources';
import { readWorkflowFile } from './workflow-file';

type Raw = Record<string, unknown>;

/** A clone or pull failure in words the user can act on (git can't ask for a password). */
export function gitSourceProblem(url: string, stderr: string): string {
  const detail = stderr.trim();
  if (
    /could not read (Username|Password)|terminal prompts disabled|Authentication failed|Permission denied \(publickey|Host key verification failed|invalid credentials|403|Repository not found/i.test(
      detail,
    )
  ) {
    return `git couldn't sign in to ${url}. The app can't ask for a password, so it needs credentials git already has: a credential helper, an SSH key loaded in ssh-agent, or a CLI login. Clone it once in a terminal to check, then try again.\n\n${detail}`;
  }
  if (/Not possible to fast-forward|diverg|non-fast-forward/i.test(detail)) {
    return `The clone has commits the remote doesn't, so it can't be fast-forwarded. Sort it out in the clone with git, or remove the source and add it again.\n\n${detail}`;
  }
  return detail || 'git failed';
}

/** The input of Add source (spec §13.2). */
export interface NewSkillSource {
  name: string;
  kind: 'folder' | 'git';
  /** A folder path (`~/…` allowed) or a git URL. */
  location: string;
  projects: string[] | null;
}

/**
 * Skill sources per profile (spec §13.2, §13.3): adding, cloning, updating
 * and removing them, what they hold, and which plugin folders each session
 * gets. Plain skill folders are wrapped in a generated plugin.
 */
export class SkillService {
  private readonly events = new EventEmitter();
  /** What each workspace's running Claude started with (spec §13.3). */
  private readonly launched = new Map<string, string>();

  constructor(
    private readonly config: ConfigStore,
    private readonly env: EnvService,
    /** The app config dir: clones and generated plugins live here (spec §3.4). */
    private readonly dataDir: string,
  ) {}

  /** Where a source is read from: its folder, or the app's clone. */
  sourceDir(profileId: string, source: Pick<SkillSource, 'id' | 'kind' | 'path'>): string {
    return source.kind === 'git'
      ? path.join(this.dataDir, 'skill-sources', profileId, source.id)
      : expandHome(source.path ?? '');
  }

  private get pluginsRoot(): string {
    return path.join(this.dataDir, 'plugins');
  }

  private source(profileId: string, sourceId: string): SkillSource {
    const source = this.env.profile(profileId).skills.find((s) => s.id === sourceId);
    if (!source) throw new Error(`Unknown skill source "${sourceId}"`);
    return source;
  }

  private projects(): Project[] {
    return this.config.require().projects;
  }

  /** The source's plugins, its commit and why it can't be used. */
  async inspect(profileId: string, sourceId: string): Promise<SourceInspection> {
    const source = this.source(profileId, sourceId);
    const dir = this.sourceDir(profileId, source);
    const detected = detectSource(dir);
    let plugins: SourceInspection['plugins'] = [];
    let error = detected.error;
    try {
      plugins = sourcePlugins(detected, (skillsDir) =>
        ensureWrapper(this.pluginsRoot, profileId, source, skillsDir),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    return {
      sourceId,
      dir,
      shape: detected.shape,
      plugins,
      commit: detected.shape === 'none' ? null : await this.commit(profileId, dir),
      error,
      workflow: readWorkflowFile(dir),
    };
  }

  async inspectAll(profileId: string): Promise<SourceInspection[]> {
    return Promise.all(
      this.env.profile(profileId).skills.map((s) => this.inspect(profileId, s.id)),
    );
  }

  private async commit(profileId: string, dir: string): Promise<SourceCommit | null> {
    try {
      const git = await this.env.git(profileId);
      const out = await git.tryRun(dir, ['log', '-1', '--format=%h%x1f%s%x1f%cI']);
      if (!out) return null;
      const [hash = '', subject = '', date = ''] = out.trim().split('\x1f');
      return hash ? { hash, subject, date } : null;
    } catch {
      return null;
    }
  }

  /**
   * The sources that apply (spec §13.3): to the given projects (a linked
   * workspace passes all of its repositories; each source once), or for null,
   * the profile's all-projects sources (the home terminal).
   */
  applying(profileId: string, projectIds: string[] | null): SkillSource[] {
    const profile = this.env.profile(profileId);
    if (projectIds === null) return profile.skills.filter((s) => s.projects === null);
    const projects = this.projects().filter((p) => projectIds.includes(p.id));
    return profile.skills.filter((s) => projects.some((p) => sourceApplies(s, p)));
  }

  /**
   * The plugin folders to load (`--plugin-dir` or `CLAUDE_CODE_PLUGIN_DIRS`)
   * and a fingerprint of what they are now (sources, folders and commits), to
   * tell when a running Claude's skills changed.
   */
  async pluginDirs(
    profileId: string,
    projectIds: string[] | null,
  ): Promise<{ dirs: string[]; fingerprint: string }> {
    const dirs: string[] = [];
    const parts: string[] = [];
    for (const source of this.applying(profileId, projectIds)) {
      const dir = this.sourceDir(profileId, source);
      const detected = detectSource(dir);
      if (detected.shape === 'skills' && detected.skillsDir) {
        try {
          dirs.push(ensureWrapper(this.pluginsRoot, profileId, source, detected.skillsDir));
        } catch {
          // Shown in the source view; nothing to load.
        }
      } else {
        dirs.push(...detected.plugins.map((p) => p.dir));
      }
      const commit = detected.shape === 'none' ? null : await this.commit(profileId, dir);
      parts.push(`${source.id}=${dir}@${commit?.hash ?? ''}:${detected.shape}`);
    }
    return { dirs, fingerprint: parts.join('\n') };
  }

  /** Adds a source; a git URL is cloned first, and nothing is saved if that fails. */
  async add(profileId: string, input: NewSkillSource): Promise<SkillSource> {
    const profile = this.env.profile(profileId);
    const name = input.name.trim() || defaultSourceName(input.location);
    const location = input.location.trim();
    if (!location) throw new Error(input.kind === 'git' ? 'Enter a git URL' : 'Choose a folder');
    const id = uniqueSlug(
      name,
      profile.skills.map((s) => s.id),
      'skills',
    );
    const entry: Raw = { id, name, kind: input.kind };
    if (input.kind === 'folder') {
      const dir = expandHome(location);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`${location} doesn't exist or isn't a folder`);
      }
      entry.path = location;
    } else {
      entry.url = location;
      await this.clone(profileId, id, location);
    }
    if (input.projects !== null) entry.projects = this.knownProjects(profileId, input.projects);
    try {
      this.config.update((raw) => {
        const target = rawProfile(raw, profileId);
        target.skills = [...(Array.isArray(target.skills) ? target.skills : []), entry];
      });
    } catch (error) {
      if (input.kind === 'git') this.removeClone(profileId, id);
      throw error;
    }
    this.changed();
    return this.source(profileId, id);
  }

  private knownProjects(profileId: string, ids: string[]): string[] {
    const own = this.projects()
      .filter((p) => p.profileId === profileId)
      .map((p) => p.id);
    return ids.filter((id) => own.includes(id));
  }

  private async clone(profileId: string, sourceId: string, url: string): Promise<void> {
    const dir = this.sourceDir(profileId, { id: sourceId, kind: 'git' });
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    const git = await this.env.git(profileId);
    try {
      await git.run(path.dirname(dir), ['clone', '--quiet', url, dir]);
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(
        gitSourceProblem(url, error instanceof GitError ? error.stderr : String(error)),
      );
    }
  }

  /** Name and which projects it applies to. */
  edit(profileId: string, sourceId: string, changes: { name: string; projects: string[] | null }) {
    const name = changes.name.trim();
    if (!name) throw new Error('Give the source a name');
    this.source(profileId, sourceId);
    const projects =
      changes.projects === null ? null : this.knownProjects(profileId, changes.projects);
    this.config.update((raw) => {
      const entry = rawSource(raw, profileId, sourceId);
      entry.name = name;
      if (projects === null) delete entry.projects;
      else entry.projects = projects;
    });
    this.changed();
  }

  /** Removes the source; its clone too when asked. A local folder is never touched. */
  remove(profileId: string, sourceId: string, { deleteClone }: { deleteClone: boolean }): void {
    const source = this.source(profileId, sourceId);
    this.config.update((raw) => {
      const target = rawProfile(raw, profileId);
      target.skills = (Array.isArray(target.skills) ? (target.skills as Raw[]) : []).filter(
        (s) => s?.id !== sourceId,
      );
      if ((target.skills as Raw[]).length === 0) delete target.skills;
      for (const project of Array.isArray(raw.projects) ? (raw.projects as Raw[]) : []) {
        if (project?.profileId !== profileId || !Array.isArray(project.skillsOff)) continue;
        project.skillsOff = (project.skillsOff as unknown[]).filter((id) => id !== sourceId);
        if ((project.skillsOff as unknown[]).length === 0) delete project.skillsOff;
      }
    });
    fs.rmSync(path.join(this.pluginsRoot, profileId, sourceId), { recursive: true, force: true });
    if (source.kind === 'git' && deleteClone) this.removeClone(profileId, sourceId);
    this.changed();
  }

  private removeClone(profileId: string, sourceId: string): void {
    fs.rmSync(this.sourceDir(profileId, { id: sourceId, kind: 'git' }), {
      recursive: true,
      force: true,
    });
  }

  /**
   * The Skills tab's switch (spec §13.2): for an all-projects source it edits
   * the project's `skillsOff`, for a selected-projects source its list.
   */
  setEnabled(projectId: string, sourceId: string, enabled: boolean): void {
    const project = this.projects().find((p) => p.id === projectId);
    if (!project) throw new Error(`Unknown project "${projectId}"`);
    const source = this.source(project.profileId, sourceId);
    this.config.update((raw) => {
      const rawProject = (Array.isArray(raw.projects) ? (raw.projects as Raw[]) : []).find(
        (p) => p?.id === projectId,
      ) as Raw;
      const off = new Set(
        Array.isArray(rawProject.skillsOff) ? (rawProject.skillsOff as string[]) : [],
      );
      if (source.projects === null) {
        if (enabled) off.delete(sourceId);
        else off.add(sourceId);
      } else {
        off.delete(sourceId);
        const entry = rawSource(raw, project.profileId, sourceId);
        const list = new Set(Array.isArray(entry.projects) ? (entry.projects as string[]) : []);
        if (enabled) list.add(projectId);
        else list.delete(projectId);
        entry.projects = [...list];
      }
      if (off.size > 0) rawProject.skillsOff = [...off];
      else delete rawProject.skillsOff;
    });
    this.changed();
  }

  /** The project's Skills tab: every source of its profile, on where it applies. */
  forProject(projectId: string): { source: SkillSource; enabled: boolean }[] {
    const project = this.projects().find((p) => p.id === projectId);
    if (!project) throw new Error(`Unknown project "${projectId}"`);
    return this.env
      .profile(project.profileId)
      .skills.map((source) => ({ source, enabled: sourceApplies(source, project) }));
  }

  /** Update: `git pull --ff-only` in the clone (spec §13.2). */
  async update(profileId: string, sourceId: string): Promise<SourceUpdate> {
    const source = this.source(profileId, sourceId);
    if (source.kind !== 'git') throw new Error('Only git sources can be updated');
    const dir = this.sourceDir(profileId, source);
    if (!fs.existsSync(dir)) {
      try {
        await this.clone(profileId, sourceId, source.url ?? '');
      } catch (error) {
        return { ok: false, message: messageOf(error), commit: null, moved: false };
      }
      this.changed();
      return {
        ok: true,
        message: 'Cloned again',
        commit: await this.commit(profileId, dir),
        moved: true,
      };
    }
    const before = await this.commit(profileId, dir);
    const git: Git = await this.env.git(profileId);
    try {
      await git.run(dir, ['pull', '--ff-only', '--quiet']);
    } catch (error) {
      return {
        ok: false,
        message: gitSourceProblem(
          source.url ?? '',
          error instanceof GitError ? error.stderr : messageOf(error),
        ),
        commit: before,
        moved: false,
      };
    }
    const after = await this.commit(profileId, dir);
    const moved = after?.hash !== before?.hash;
    if (moved) this.changed();
    return {
      ok: true,
      message: moved && after ? `Updated to ${after.hash} ${after.subject}` : 'Already up to date',
      commit: after,
      moved,
    };
  }

  /** A workspace's Claude started with these skills (spec §13.3). */
  claudeStarted(workspaceId: string, fingerprint: string): void {
    this.launched.set(workspaceId, fingerprint);
    this.changed();
  }

  claudeStopped(workspaceId: string): void {
    if (this.launched.delete(workspaceId)) this.changed();
  }

  /**
   * The workspaces whose running Claude started with other skills than they
   * would get now: their header offers Skills changed · Restart Claude.
   */
  async changedWorkspaces(
    running: { workspaceId: string; profileId: string; projectIds: string[] }[],
  ): Promise<string[]> {
    const out: string[] = [];
    for (const w of running) {
      const started = this.launched.get(w.workspaceId);
      if (started === undefined) continue;
      const now = await this.pluginDirs(w.profileId, w.projectIds);
      if (now.fingerprint !== started) out.push(w.workspaceId);
    }
    return out;
  }

  /** Sources, their contents or a session's skills changed. */
  onChange(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  private changed(): void {
    this.events.emit('change');
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A source's default name: the last part of its path or URL, without `.git`. */
export function defaultSourceName(location: string): string {
  const last =
    location
      .trim()
      .replace(/[/\\]+$/, '')
      .split(/[/\\:]/)
      .pop() ?? '';
  return last.replace(/\.git$/, '') || 'skills';
}

function rawProfile(raw: Raw, profileId: string): Raw {
  const entry = (Array.isArray(raw.profiles) ? (raw.profiles as Raw[]) : []).find(
    (p) => p?.id === profileId,
  );
  if (!entry) throw new Error(`Unknown profile "${profileId}"`);
  return entry;
}

function rawSource(raw: Raw, profileId: string, sourceId: string): Raw {
  const profile = rawProfile(raw, profileId);
  const entry = (Array.isArray(profile.skills) ? (profile.skills as Raw[]) : []).find(
    (s) => s?.id === sourceId,
  );
  if (!entry) throw new Error(`Unknown skill source "${sourceId}"`);
  return entry;
}
