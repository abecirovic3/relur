import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { projectWorktreeDir } from '@shared/projects';
import type { OtherWorktree } from '@shared/workspaces';
import type { ConfigStore } from '../config/store';
import { expandHome } from '../paths';

/** Folder changes closer together than this are checked once; git needs a moment to register the worktree. */
const SETTLE_MS = 1500;
/** On window focus, a project is checked at most this often. */
const FOCUS_CHECK_MS = 60_000;

/** A worktree that appeared since the app started and isn't a workspace (spec §13.6). */
export interface NewWorktree {
  projectId: string;
  projectName: string;
  path: string;
  branch: string | null;
}

/** What the notices need from the workspace service. */
export interface WorktreeLister {
  otherWorktrees(projectId: string): Promise<OtherWorktree[]>;
}

/**
 * Notices new worktrees (spec §13.6): a watch on each project's worktree
 * folder for new subfolders, and `git worktree list` when the window gains
 * focus. Only worktrees that appear after launch are reported, each once.
 */
export class WorktreeNotices {
  private readonly events = new EventEmitter();
  /** Per project, the unknown worktrees already seen (reported or there at launch). */
  private readonly seen = new Map<string, Set<string>>();
  private readonly watchers = new Map<string, { dir: string; watcher: fs.FSWatcher }>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly lastCheck = new Map<string, number>();

  constructor(
    private readonly config: ConfigStore,
    private readonly lister: WorktreeLister,
    private readonly settleMs = SETTLE_MS,
  ) {
    config.onChange(() => void this.sync());
  }

  /** Takes the baseline of every project and starts watching. */
  start(): Promise<void> {
    return this.sync();
  }

  /** New projects get a baseline and a watch; removed ones lose theirs. */
  private async sync(): Promise<void> {
    const config = this.config.get().config;
    if (!config) return;
    const ids = new Set(config.projects.map((p) => p.id));
    for (const project of config.projects) {
      const profile = config.profiles.find((p) => p.id === project.profileId);
      if (!profile) continue;
      if (!this.seen.has(project.id)) {
        this.seen.set(project.id, new Set());
        await this.check(project.id, { report: false });
      }
      this.watch(project.id, expandHome(projectWorktreeDir(profile, project)));
    }
    for (const id of [...this.seen.keys()]) {
      if (ids.has(id)) continue;
      this.seen.delete(id);
      this.watch(id, null);
    }
  }

  private watch(projectId: string, dir: string | null): void {
    const current = this.watchers.get(projectId);
    const exists = dir !== null && fs.existsSync(dir);
    if (current && exists && current.dir === dir) return;
    if (current) {
      current.watcher.close();
      this.watchers.delete(projectId);
    }
    if (!exists || dir === null) return;
    try {
      const watcher = fs.watch(dir, () => this.soon(projectId));
      watcher.on('error', () => this.watch(projectId, null));
      this.watchers.set(projectId, { dir, watcher });
    } catch {
      // Focus checks still find it.
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

  /** The window gained focus: checks projects not checked in the last minute. */
  focused(now = Date.now()): void {
    for (const id of this.seen.keys()) {
      if (now - (this.lastCheck.get(id) ?? 0) >= FOCUS_CHECK_MS) void this.check(id);
    }
    // A worktree folder made since launch (the first worktree there) gets its watch.
    void this.sync();
  }

  /** Lists the project's unknown worktrees and reports the ones not seen before. */
  async check(projectId: string, { report = true }: { report?: boolean } = {}): Promise<void> {
    this.lastCheck.set(projectId, Date.now());
    const seen = this.seen.get(projectId);
    if (!seen) return;
    let others: OtherWorktree[];
    try {
      others = await this.lister.otherWorktrees(projectId);
    } catch {
      return;
    }
    const project = this.config.get().config?.projects.find((p) => p.id === projectId);
    for (const w of others) {
      if (seen.has(w.path)) continue;
      seen.add(w.path);
      if (report && project) {
        this.events.emit('new', {
          projectId,
          projectName: project.name,
          path: w.path,
          branch: w.branch,
        } satisfies NewWorktree);
      }
    }
  }

  onNew(listener: (worktree: NewWorktree) => void): () => void {
    this.events.on('new', listener);
    return () => this.events.off('new', listener);
  }

  dispose(): void {
    for (const id of [...this.watchers.keys()]) this.watch(id, null);
    for (const timer of this.timers.values()) clearTimeout(timer);
  }
}
