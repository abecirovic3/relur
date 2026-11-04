import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { Project } from '@shared/schemas';
import type { ConfigStore } from '../config/store';
import { expandHome } from '../paths';

/** Writes to the git folder closer together than this are checked once. */
const SETTLE_MS = 500;

/** A project without a remote that took `origin` (spec §6.10). */
export interface RemoteFound {
  projectId: string;
  projectName: string;
  remote: string;
}

/** What the watch needs from the project service. */
export interface RemotePicker {
  remotes(projectId: string): Promise<string[]>;
  pickUpRemote(projectId: string): Promise<Project | null>;
}

/**
 * Picks up an `origin` that appears in a project without a remote (spec
 * §6.10): a watch on the repository's git folder for `config` changes (as
 * `git remote add` makes, also from a terminal of the app), and a check when
 * the window gains focus. Only an origin added after the watch began counts,
 * so a project set to no remote on purpose stays that way. Projects with a
 * remote aren't watched.
 */
export class RemoteWatch {
  private readonly events = new EventEmitter();
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** Per watched project, the remotes it had when the watch began. */
  private readonly baseline = new Map<string, Set<string>>();

  constructor(
    private readonly config: ConfigStore,
    private readonly picker: RemotePicker,
    private readonly settleMs = SETTLE_MS,
  ) {
    config.onChange(() => this.sync());
  }

  start(): void {
    this.sync();
    this.focused();
  }

  /** Watches the projects without a remote; stops watching the others. */
  private sync(): void {
    const projects = this.config.get().config?.projects ?? [];
    const wanted = new Set(projects.filter((p) => p.remote === null).map((p) => p.id));
    for (const [id, watcher] of this.watchers) {
      if (wanted.has(id)) continue;
      watcher.close();
      this.watchers.delete(id);
    }
    for (const id of [...this.baseline.keys()]) if (!wanted.has(id)) this.baseline.delete(id);
    for (const project of projects) {
      if (!wanted.has(project.id) || this.watchers.has(project.id)) continue;
      if (!this.baseline.has(project.id)) {
        // Until the remotes are known, nothing counts as new.
        this.baseline.set(project.id, new Set(['origin']));
        void this.picker
          .remotes(project.id)
          .then((remotes) => this.baseline.set(project.id, new Set(remotes)))
          .catch(() => this.baseline.set(project.id, new Set()));
      }
      const gitDir = path.join(expandHome(project.repoPath), '.git');
      if (!fs.statSync(gitDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      try {
        // git writes config.lock and renames it, so the folder is watched.
        const watcher = fs.watch(gitDir, (_event, file) => {
          if (file === 'config') this.soon(project.id);
        });
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(project.id);
        });
        this.watchers.set(project.id, watcher);
      } catch {
        // Focus checks still find it.
      }
    }
  }

  private soon(projectId: string): void {
    clearTimeout(this.timers.get(projectId));
    this.timers.set(
      projectId,
      setTimeout(() => {
        this.timers.delete(projectId);
        void this.check(projectId);
      }, this.settleMs),
    );
  }

  /** The window gained focus: checks every project without a remote. */
  focused(): void {
    for (const project of this.config.get().config?.projects ?? []) {
      if (project.remote === null) void this.check(project.id);
    }
  }

  async check(projectId: string): Promise<void> {
    const before = this.baseline.get(projectId);
    if (!before) return;
    const remotes = await this.picker.remotes(projectId).catch(() => null);
    if (!remotes) return;
    const appeared = remotes.includes('origin') && !before.has('origin');
    this.baseline.set(projectId, new Set(remotes));
    if (!appeared) return;
    const project = await this.picker.pickUpRemote(projectId).catch(() => null);
    if (!project?.remote) return;
    this.events.emit('found', {
      projectId,
      projectName: project.name,
      remote: project.remote,
    } satisfies RemoteFound);
  }

  onFound(listener: (found: RemoteFound) => void): () => void {
    this.events.on('found', listener);
    return () => this.events.off('found', listener);
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.baseline.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
  }
}
