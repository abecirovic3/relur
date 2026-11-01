import { parse as parseYaml } from 'yaml';

const FRONT_MATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(\r?\n|$)/;
const withoutBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/** A Markdown file's text after its front matter. */
export function markdownBody(text: string): string {
  const plain = withoutBom(text);
  const match = FRONT_MATTER.exec(plain);
  return match ? plain.slice(match[0].length) : plain;
}

/**
 * The YAML front matter of a Markdown file: the block between a leading
 * `---` line and the next one. Null when there is none; throws when it isn't
 * a YAML mapping and has no `key: value` lines either.
 *
 * As lenient as Claude Code (spec §13.4): when strict YAML fails, for example
 * on `description: Use when: …`, the top-level `key: value` lines are read
 * instead, each value being everything after the first `: `.
 */
export function frontMatter(text: string): Record<string, unknown> | null {
  const match = FRONT_MATTER.exec(withoutBom(text));
  if (!match) return null;
  const block = match[1] ?? '';
  let value: unknown;
  try {
    value = parseYaml(block);
  } catch (error) {
    const lines = keyValueLines(block);
    if (lines) return lines;
    throw error;
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('its front matter is not a list of fields');
  }
  return value as Record<string, unknown>;
}

/** The block's unindented `key: value` lines; null when it has none. */
function keyValueLines(block: string): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  let found = false;
  for (const line of block.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w.-]*):(?:[ \t]+(.*))?$/.exec(line.trimEnd());
    if (!kv?.[1]) continue;
    found = true;
    fields[kv[1]] = unquote(kv[2]?.trim() ?? '') || null;
  }
  return found ? fields : null;
}

const unquote = (value: string) =>
  /^(["']).*\1$/.test(value) && value.length >= 2 ? value.slice(1, -1) : value;
