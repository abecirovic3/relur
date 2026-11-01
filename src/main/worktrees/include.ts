import fs from 'node:fs';
import path from 'node:path';
import type { Git } from '../git/git';

/**
 * `.worktreeinclude` (spec §8.2), matched as Claude Code does: the file uses
 * `.gitignore` syntax, and only files that match a pattern *and* are
 * gitignored are copied, so tracked files are never duplicated. A pattern
 * that starts with `**` and a slash (or has no slash, which means the same)
 * reaches into a wholly ignored folder only when that folder matches the
 * pattern itself, or when the first name after the `**` is one of the names
 * in its path; so `.env` never walks `node_modules`, while a `**` pattern for
 * `.claude/skills/*.md` reads an ignored `.claude` folder. Files are copied,
 * never symlinked.
 */
export const INCLUDE_FILE = '.worktreeinclude';

export interface IncludePattern {
  /** The line as written. */
  source: string;
  negate: boolean;
  /** A trailing `/`: matches folders only. */
  dirOnly: boolean;
  /** Matches a path relative to the repository root, `/`-separated. */
  regex: RegExp;
  /** Path segments as globs, after a leading `**` segment if any. */
  segments: string[];
  /** Starts with a `**` segment, written or implied by having no slash. */
  anyDepth: boolean;
}

function escapeRegex(c: string): string {
  return /[\\^$.*+?()[\]{}|/]/.test(c) ? `\\${c}` : c;
}

/** One segment glob (no `/`) as a regex source. */
function segmentSource(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '\\' && i + 1 < glob.length) {
      out += escapeRegex(glob[++i] as string);
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '[') {
      const end = glob.indexOf(']', i + 2);
      if (end === -1) {
        out += '\\[';
        continue;
      }
      let body = glob.slice(i + 1, end);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      out += `[${body.replace(/\\/g, '\\\\')}]`;
      i = end;
    } else {
      out += escapeRegex(c);
    }
  }
  return out;
}

const segmentRegex = (glob: string) => new RegExp(`^${segmentSource(glob)}$`);

/** Parses `.gitignore`-syntax lines; blank lines and comments are skipped. */
export function parseIncludeFile(text: string): IncludePattern[] {
  const patterns: IncludePattern[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Trailing spaces are ignored unless escaped.
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const source = line;
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/') && !line.endsWith('\\/')) {
      dirOnly = true;
      line = line.replace(/\/+$/, '');
    }
    if (!line) continue;
    // A slash at the start or in the middle anchors it to the root.
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    let segments = line.split('/');
    let anyDepth = !anchored;
    if (segments[0] === '**') {
      anyDepth = true;
      segments = segments.slice(1);
      if (segments.length === 0) segments = ['**'];
    }
    let body = '';
    segments.forEach((segment, index) => {
      const last = index === segments.length - 1;
      if (segment === '**') body += last ? '.*' : '(?:[^/]+/)*';
      else body += segmentSource(segment) + (last ? '' : '/');
    });
    const regex = new RegExp(`^${anyDepth ? '(?:[^/]+/)*' : ''}${body}$`);
    patterns.push({ source, negate, dirOnly, regex, segments, anyDepth });
  }
  return patterns;
}

/** The last pattern that matches `rel` itself (a folder when `isDir`), or null. */
function lastMatch(patterns: IncludePattern[], rel: string, isDir: boolean): IncludePattern | null {
  let found: IncludePattern | null = null;
  for (const p of patterns) {
    if (p.dirOnly && !isDir) continue;
    if (p.regex.test(rel)) found = p;
  }
  return found;
}

/**
 * The pattern that includes the file at `rel`, or null when it isn't
 * included. As in git, a matched folder includes everything in it, and a
 * file can't be re-included under it.
 */
export function includingPattern(patterns: IncludePattern[], rel: string): IncludePattern | null {
  const parts = rel.split('/');
  for (let n = 1; n < parts.length; n++) {
    const match = lastMatch(patterns, parts.slice(0, n).join('/'), true);
    if (match) return match.negate ? null : match;
  }
  const match = lastMatch(patterns, rel, false);
  return match && !match.negate ? match : null;
}

/**
 * Whether files inside the wholly ignored folder `dir` can be reached by
 * `pattern` (Claude Code's rule for `**` patterns, see above).
 */
export function reachesIgnoredDir(pattern: IncludePattern, dir: string): boolean {
  if (pattern.negate) return false;
  const names = dir.split('/');
  if (lastMatch([pattern], dir, true)) return true;
  if (pattern.anyDepth) {
    const first = pattern.segments[0] ?? '**';
    if (first === '**') return true;
    const firstRegex = segmentRegex(first);
    return names.some((name) => firstRegex.test(name));
  }
  // Anchored: the folder must fit the start of the pattern.
  for (const [index, name] of names.entries()) {
    const segment = pattern.segments[index];
    if (segment === undefined) return false;
    if (segment === '**') return true;
    if (!segmentRegex(segment).test(name)) return false;
  }
  return true;
}

/** Files under `dir` (absolute), as paths relative to `root`; symlinks are left out. */
function walk(root: string, dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
}

/**
 * The gitignored files of the main checkout that `.worktreeinclude` selects,
 * relative to the checkout. Empty without a `.worktreeinclude`.
 */
export async function includedFiles(git: Git, repo: string): Promise<string[]> {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repo, INCLUDE_FILE), 'utf8');
  } catch {
    return [];
  }
  const patterns = parseIncludeFile(text);
  if (!patterns.some((p) => !p.negate)) return [];
  // Ignored files, with wholly ignored folders collapsed to `dir/`.
  const out = await git.run(repo, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
  ]);
  const files: string[] = [];
  for (const entry of out.split('\0').filter(Boolean)) {
    if (!entry.endsWith('/')) {
      if (includingPattern(patterns, entry)) files.push(entry);
      continue;
    }
    const dir = entry.slice(0, -1);
    const reaching = patterns.filter((p) => reachesIgnoredDir(p, dir));
    if (reaching.length === 0) continue;
    const inside: string[] = [];
    walk(repo, path.join(repo, dir), inside);
    for (const file of inside) {
      const pattern = includingPattern(patterns, file);
      if (pattern && reaching.includes(pattern)) files.push(file);
    }
  }
  return [...new Set(files)].sort();
}

/**
 * Copies the included files from the main checkout into a new worktree
 * (spec §7.3 step 3). Copies, never symlinks; existing files are kept.
 * Returns the copied paths.
 */
export async function copyIncludedFiles(
  git: Git,
  repo: string,
  worktree: string,
): Promise<string[]> {
  const copied: string[] = [];
  for (const rel of await includedFiles(git, repo)) {
    const from = path.join(repo, rel);
    const to = path.join(worktree, rel);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    // Follows a symlinked file and copies its content.
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(to, fs.statSync(from).mode & 0o777);
    copied.push(rel);
  }
  return copied;
}
