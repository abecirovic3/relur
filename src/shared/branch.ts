/** Branch names for new workspaces (spec §7.1). */

const TRANSLITERATE: Record<string, string> = { č: 'c', ć: 'c', š: 's', ž: 'z', đ: 'dj' };

/**
 * `{slug}` from a title: lowercase, transliterated to ASCII, any other
 * non-alphanumeric character becomes `-`, repeated dashes collapse, at most
 * 50 characters cut at a word boundary.
 */
export function slugify(title: string, max = 50): string {
  const ascii = title
    .toLowerCase()
    .replace(/[čćšžđ]/g, (c) => TRANSLITERATE[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max + 1);
  const boundary = cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, max)).replace(/-+$/, '');
}

/** The slug for text that gives none, such as text in another script. */
export const FALLBACK_SLUG = 'task';

/**
 * Fills a branch template (`{id}`, `{slug}`). A separator next to an empty
 * token is dropped, so `{id}-{slug}` gives `PROJ-123-fix-login`, `PROJ-123`
 * or `fix-login`. Any text gives a valid branch name (spec §7.1): a template
 * with only one of the tokens fills it from the other, text that slugs
 * to nothing gives `task`, and what git refuses is replaced.
 */
export function branchFromTemplate(
  template: string,
  task: { id?: string | null; title?: string | null },
): string {
  const id = (task.id ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-');
  let slug = slugify(task.title ?? '');
  if (!id && !slug && (task.title ?? '').trim()) slug = FALLBACK_SLUG;
  // A template with one of the tokens takes the other's value in its place.
  const values: Record<string, string> = {
    id: id || (template.includes('{slug}') ? '' : slug),
    slug: slug || (template.includes('{id}') ? '' : id),
  };
  // Split into tokens and the literal text around them.
  const parts = template.split(/(\{id\}|\{slug\})/).filter((p) => p !== '');
  const filled = parts.map((p) => {
    const token = /^\{(id|slug)\}$/.exec(p)?.[1];
    return token ? { token: true, text: values[token] ?? '' } : { token: false, text: p };
  });
  let out = '';
  filled.forEach((part, i) => {
    if (part.token) {
      out += part.text;
      return;
    }
    // Text between two tokens is a separator; a prefix or suffix always stays.
    const before = filled
      .slice(0, i)
      .reverse()
      .find((p) => p.token);
    const after = filled.slice(i + 1).find((p) => p.token);
    if (before && after && (!before.text || !after.text)) return;
    out += part.text;
  });
  return validBranchName(out.replace(/^[-_/.]+|[-_/.]+$/g, ''));
}

/**
 * `name` with what `git check-ref-format --branch` refuses replaced by `-`:
 * spaces, control characters, `~ ^ : ? * [ \`, `..` and `@{`; a part that
 * starts with `.` or ends with `.lock` or `.`; empty parts; dashes at either
 * end; a name that is only `@` or `HEAD`.
 */
export function validBranchName(name: string): string {
  const parts = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: git refuses them
    .replace(/[\x00-\x20\x7f~^:?*[\\]+/g, '-')
    .replace(/@\{/g, '-')
    .replace(/\.{2,}/g, '-')
    .split('/')
    .map((p) =>
      p
        .replace(/^\.+/, '')
        .replace(/\.lock$/, '-lock')
        .replace(/\.+$/, '')
        .replace(/-{2,}/g, '-'),
    )
    .filter(Boolean);
  const out = parts.join('/').replace(/^-+|-+$/g, '');
  return out === '@' || out === 'HEAD' ? '' : out;
}

/** The next name to try when `branch` is taken: `branch-2`, `branch-3` … */
export const numberedBranch = (branch: string, n: number) => `${branch}-${n}`;
