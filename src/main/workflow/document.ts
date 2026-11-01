import fs from 'node:fs';
import path from 'node:path';
import type { Workflow } from '@shared/schemas';
import { documentLabel, type StatusDocument } from '@shared/workflow';
import { frontMatter, markdownBody } from '../frontmatter';
import { fieldText, MAX_STATUS_FILE_BYTES } from './read';

/** Images larger than this aren't shown in the spec view. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** The status file for the spec view (spec §13.8): its text and front matter values. */
export function readDocument(worktree: string, file: string, workflow: Workflow): StatusDocument {
  const full = path.join(worktree, file);
  if (fs.statSync(full).size > MAX_STATUS_FILE_BYTES) throw new Error(`${file} is over 256 KB`);
  const text = fs.readFileSync(full, 'utf8');
  let fields: Record<string, unknown> = {};
  try {
    fields = frontMatter(text) ?? {};
  } catch {
    // The view still shows the text.
  }
  const shown: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    const text = fieldText(value);
    if (text !== null) shown[key] = text;
  }
  return {
    file,
    label: documentLabel(workflow, file),
    markdown: markdownBody(text),
    fields: shown,
  };
}

/** Whether `child` is `root` or inside it. */
const inside = (root: string, child: string) => {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/**
 * The status file's relative images as `data:` URLs (spec §13.8): only files
 * inside the worktree (links followed), of an image type, at most 5 MB.
 * Anything else, a web address included, gives null.
 */
export function documentImages(
  worktree: string,
  file: string,
  sources: string[],
): Record<string, string | null> {
  let root: string;
  try {
    root = fs.realpathSync(worktree);
  } catch {
    return Object.fromEntries(sources.map((s) => [s, null]));
  }
  const image = (source: string): string | null => {
    if (/^[a-z][a-z0-9+.-]*:|^\/\/|^\//i.test(source)) return null;
    let relative: string;
    try {
      relative = decodeURIComponent(source.replace(/[?#].*$/, ''));
    } catch {
      return null;
    }
    const type = IMAGE_TYPES[path.extname(relative).toLowerCase()];
    if (!type) return null;
    try {
      const real = fs.realpathSync(path.resolve(root, path.dirname(file), relative));
      if (!inside(root, real)) return null;
      const stat = fs.statSync(real);
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
      return `data:${type};base64,${fs.readFileSync(real).toString('base64')}`;
    } catch {
      return null;
    }
  };
  return Object.fromEntries(sources.map((s) => [s, image(s)]));
}
