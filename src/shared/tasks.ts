/**
 * The New workspace dialog's one Task field (spec §7.1): a leading key,
 * `ABC-123` or `#42`, is the id; a `:`, `-` or spaces after it are skipped and
 * the rest is the title.
 */
export function parseTask(text: string): { id: string | null; title: string } {
  const trimmed = text.trim();
  const match = /^([A-Z][A-Z0-9]*-\d+|#\d+)(?=$|[\s:–-])[\s:–-]*/.exec(trimmed);
  if (!match?.[1]) return { id: null, title: trimmed };
  return { id: match[1], title: trimmed.slice(match[0].length).trim() };
}
