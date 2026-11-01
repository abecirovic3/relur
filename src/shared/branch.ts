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

/**
 * Fills a branch template (`{id}`, `{slug}`). A separator next to an empty
 * token is dropped, so `{id}-{slug}` gives `PROJ-123-fix-login`, `PROJ-123`
 * or `fix-login`.
 */
export function branchFromTemplate(
  template: string,
  task: { id?: string | null; title?: string | null },
): string {
  const values: Record<string, string> = {
    id: (task.id ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-'),
    slug: slugify(task.title ?? ''),
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
  return out.replace(/^[-_/.]+|[-_/.]+$/g, '');
}
