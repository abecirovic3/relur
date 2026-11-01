import fs from 'node:fs';
import path from 'node:path';
import type { SkillSource } from '@shared/schemas';
import type { PluginInfo, SkillInfo, SourceShape } from '@shared/skills';
import { frontMatter } from '../frontmatter';

/** Files larger than this aren't read as `SKILL.md` or plugin manifests. */
const MAX_FILE_BYTES = 256 * 1024;

const PLUGIN_MANIFEST = path.join('.claude-plugin', 'plugin.json');
const MARKETPLACE_MANIFEST = path.join('.claude-plugin', 'marketplace.json');

const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const isFile = (p: string) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function readJson(file: string): Record<string, unknown> | null {
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    return record(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return null;
  }
}

/** Child folders, sorted, without hidden ones. */
function childDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .sort()
      .map((name) => path.join(dir, name))
      .filter(isDir);
  } catch {
    return [];
  }
}

/** A skill folder's name and description from its `SKILL.md` (spec §13.2). */
export function readSkill(skillDir: string): SkillInfo {
  const fallback = path.basename(skillDir);
  const file = path.join(skillDir, 'SKILL.md');
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) {
      return { name: fallback, description: null, error: 'SKILL.md is over 256 KB' };
    }
    const fields = frontMatter(fs.readFileSync(file, 'utf8'));
    if (!fields)
      return { name: fallback, description: null, error: 'SKILL.md has no front matter' };
    const name =
      typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim() : fallback;
    const description =
      typeof fields.description === 'string' && fields.description.trim()
        ? fields.description.trim()
        : null;
    return { name, description, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name: fallback, description: null, error: `SKILL.md can't be read: ${reason}` };
  }
}

/** The skill folders (`<name>/SKILL.md`) directly in `dir`. */
function skillDirs(dir: string): string[] {
  return childDirs(dir).filter((d) => isFile(path.join(d, 'SKILL.md')));
}

/** A plugin's skills: `skills/<name>/SKILL.md` in its folder. */
export function pluginSkills(pluginDir: string): SkillInfo[] {
  return skillDirs(path.join(pluginDir, 'skills')).map(readSkill);
}

/** The name Claude Code gives a plugin: its manifest's, else its folder's. */
function pluginName(dir: string, fallback = path.basename(dir)): string {
  const name = readJson(path.join(dir, PLUGIN_MANIFEST))?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : fallback;
}

/** What a source folder holds, before plain skills are wrapped. */
export interface DetectedSource {
  shape: SourceShape;
  /** The plugins to load; for `skills`, empty until wrapped. */
  plugins: { name: string; dir: string }[];
  /** For `skills`: the folder holding the skill folders. */
  skillsDir: string | null;
  error: string | null;
}

/**
 * Detects a source's shape (spec §13.2): a plugin (its own manifest, even
 * when it is also its own marketplace), a folder of plugins (child plugins,
 * or a marketplace listing plugins by relative path), or plain skill folders
 * in the folder itself or its `skills/`.
 */
export function detectSource(dir: string): DetectedSource {
  const none = (error: string): DetectedSource => ({
    shape: 'none',
    plugins: [],
    skillsDir: null,
    error,
  });
  if (!isDir(dir)) return none(`${dir} doesn't exist or isn't a folder`);
  if (isFile(path.join(dir, PLUGIN_MANIFEST))) {
    return {
      shape: 'plugin',
      plugins: [{ name: pluginName(dir), dir }],
      skillsDir: null,
      error: null,
    };
  }
  const marketplace = readJson(path.join(dir, MARKETPLACE_MANIFEST));
  if (marketplace) {
    const listed = (Array.isArray(marketplace.plugins) ? marketplace.plugins : [])
      .map(record)
      .flatMap((entry) => {
        const source = entry.source;
        if (typeof source !== 'string' || !source.startsWith('./')) return [];
        const pluginDir = path.resolve(dir, source);
        // Only folders inside the source: a listing can't point elsewhere.
        if (!pluginDir.startsWith(dir + path.sep) || !isDir(pluginDir)) return [];
        const fallback = typeof entry.name === 'string' ? entry.name : path.basename(pluginDir);
        return [{ name: pluginName(pluginDir, fallback), dir: pluginDir }];
      });
    if (listed.length > 0) {
      return { shape: 'plugins', plugins: listed, skillsDir: null, error: null };
    }
  }
  const children = childDirs(dir).filter((d) => isFile(path.join(d, PLUGIN_MANIFEST)));
  if (children.length > 0) {
    return {
      shape: 'plugins',
      plugins: children.map((d) => ({ name: pluginName(d), dir: d })),
      skillsDir: null,
      error: null,
    };
  }
  for (const skillsDir of [dir, path.join(dir, 'skills')]) {
    if (skillDirs(skillsDir).length > 0) {
      return { shape: 'skills', plugins: [], skillsDir, error: null };
    }
  }
  return none('No plugin or skills found');
}

/** The plugin name a wrapped plain folder gets: the source's name as a slug. */
export function wrapperName(source: Pick<SkillSource, 'name' | 'id'>): string {
  const slug = source.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || source.id;
}

/**
 * The generated plugin around a plain skills folder (spec §13.2): a manifest
 * named after the source, and `skills` linking to the folder, so edits show
 * at the next start without copying. Rewritten when the name or folder
 * changed; returns the plugin's folder.
 */
export function ensureWrapper(
  pluginsRoot: string,
  profileId: string,
  source: Pick<SkillSource, 'id' | 'name'>,
  skillsDir: string,
): string {
  const dir = path.join(pluginsRoot, profileId, source.id);
  const manifest = path.join(dir, PLUGIN_MANIFEST);
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  const content = `${JSON.stringify(
    { name: wrapperName(source), description: `Skills from ${skillsDir}` },
    null,
    2,
  )}\n`;
  let current: string | null = null;
  try {
    current = fs.readFileSync(manifest, 'utf8');
  } catch {
    // Not written yet.
  }
  if (current !== content) fs.writeFileSync(manifest, content);
  const link = path.join(dir, 'skills');
  let target: string | null = null;
  try {
    target = fs.readlinkSync(link);
  } catch {
    // Missing, or not a link.
  }
  if (target !== skillsDir) {
    fs.rmSync(link, { recursive: true, force: true });
    // A junction on Windows needs no extra rights; elsewhere the type is ignored.
    fs.symlinkSync(skillsDir, link, 'junction');
  }
  return dir;
}

/** A source's plugins with their skills, plain folders through their wrapper. */
export function sourcePlugins(
  detected: DetectedSource,
  wrap: (skillsDir: string) => string,
): PluginInfo[] {
  if (detected.shape === 'skills' && detected.skillsDir) {
    const dir = wrap(detected.skillsDir);
    return [{ name: pluginName(dir), dir, skills: skillDirs(detected.skillsDir).map(readSkill) }];
  }
  return detected.plugins.map((p) => ({ ...p, skills: pluginSkills(p.dir) }));
}
