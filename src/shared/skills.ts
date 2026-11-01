import type { Project, SkillSource } from './schemas';
import type { WorkflowFileRead } from './workflow-file';

/**
 * What a skill source holds (spec §13.2): one plugin, several plugins (child
 * folders or a marketplace), plain skill folders the app wraps in a plugin, or
 * nothing it can load.
 */
export type SourceShape = 'plugin' | 'plugins' | 'skills' | 'none';

/** One skill, from its `SKILL.md` front matter. */
export interface SkillInfo {
  name: string;
  description: string | null;
  /** Why its `SKILL.md` couldn't be read; null when it could. */
  error: string | null;
}

/** One plugin of a source, with the name Claude Code prefixes its skills with. */
export interface PluginInfo {
  name: string;
  dir: string;
  skills: SkillInfo[];
}

export interface SourceCommit {
  hash: string;
  subject: string;
  /** ISO 8601 committer date. */
  date: string;
}

/** A skill source as found on disk now. */
export interface SourceInspection {
  sourceId: string;
  /** Where it is read from: the folder, or the app's clone of the git URL. */
  dir: string;
  shape: SourceShape;
  plugins: PluginInfo[];
  /** The commit it is on, when it is in a git checkout. */
  commit: SourceCommit | null;
  /** Why it can't be used (missing folder, nothing found); null when it can. */
  error: string | null;
  /** The workflow file at its root (spec §13.9), read; null without one. */
  workflow: WorkflowFileRead | null;
}

/** The result of Update (git pull --ff-only, spec §13.2). */
export interface SourceUpdate {
  ok: boolean;
  /** "Already up to date", the new commit, or git's error in plain words. */
  message: string;
  commit: SourceCommit | null;
  /** It brought other commits (or cloned again): its workflow is offered again (§13.9). */
  moved: boolean;
}

/**
 * Whether a source applies to a project (spec §13.2): it covers the project
 * (all projects, or the project is selected) and isn't switched off there.
 */
export function sourceApplies(
  source: Pick<SkillSource, 'id' | 'projects'>,
  project: Pick<Project, 'id' | 'skillsOff'>,
): boolean {
  if (source.projects !== null && !source.projects.includes(project.id)) return false;
  return !project.skillsOff.includes(source.id);
}
