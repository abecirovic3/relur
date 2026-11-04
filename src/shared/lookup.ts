import type { TaskLookup } from './schemas';

/** What a task lookup gave (spec §13.7): a title, or why there is none. */
export type LookupResult =
  | { ok: true; title: string }
  | {
      ok: false;
      message: string;
      /** Tools Claude asked for and wasn't allowed, for "Allow this tool". */
      refused: string[];
      /** Claude's own explanation, shortened, when it gives no title and names no tool. */
      detail?: string;
      /**
       * The lookup ran and found no such task (empty output, or Claude found
       * no title): New workspace goes on without a title (spec §13.7).
       */
      notFound?: boolean;
    };

export const lookupFailed = (
  message: string,
  refused: string[] = [],
  detail?: string,
): LookupResult => ({ ok: false, message, refused, ...(detail ? { detail } : {}) });

/** The lookup ran and found no such task (spec §13.7). */
export const lookupNotFound = (message: string, detail?: string): LookupResult => ({
  ok: false,
  message,
  refused: [],
  ...(detail ? { detail } : {}),
  notFound: true,
});

/** Titles longer than this are cut. */
const MAX_TITLE = 200;

/**
 * The title in a lookup's output: its first non-empty line, without Markdown
 * marks, a `Title:` label, surrounding quotes or the task id in front.
 */
export function cleanTitle(output: string, id: string): string | null {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  let title = line
    .replace(/^(#+|>|[-*•]|\d+\.)\s+/, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^title:\s*/i, '')
    .trim();
  const quoted = /^(["'“‘])(.*)(["'”’])$/.exec(title);
  if (quoted) title = (quoted[2] ?? '').trim();
  if (id && title.startsWith(id)) {
    const rest = title.slice(id.length);
    const sep = /^[\s:–-]+/.exec(rest);
    if (sep) title = rest.slice(sep[0].length).trim();
  }
  if (title.length > MAX_TITLE) {
    const cut = title.slice(0, MAX_TITLE + 1);
    title = cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : MAX_TITLE).trimEnd();
  }
  return title || null;
}

/** Whether a permission rule names a connector's tool or a whole connector (`mcp__…`). */
export const isConnectorTool = (rule: string) => rule.startsWith('mcp__');

/**
 * Built-in tools that read or change files, run commands, reach the web or
 * start other agents: a lookup denies them (spec §13.7) unless its rules name
 * them (`Bash(tracker issue view:*)` needs Bash, as a deny would win over it).
 * Other built-ins are left alone: denying or removing some of them hides
 * claude.ai connectors in some installs, and `dontAsk` refuses what isn't allowed.
 */
export const LOOKUP_DENIED_TOOLS = [
  'Bash',
  'Read',
  'Glob',
  'Grep',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
  'Task',
  'Agent',
  'Skill',
];

/** The tools a lookup denies: the risky built-ins its rules don't name. */
export function deniedTools(rules: string[]): string[] {
  const named = new Set(rules.map((r) => r.replace(/\(.*$/, '').trim()));
  return LOOKUP_DENIED_TOOLS.filter((t) => !named.has(t));
}

/**
 * Whether a tool's name looks like it changes something. The lookup reads
 * tickets written by other people, so it should only get read tools.
 */
export function looksLikeWriteTool(rule: string): boolean {
  const name = rule.replace(/\(.*$/, '');
  if (/^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(name) && !rule.includes('(')) return true;
  const last = name.split('__').pop() ?? name;
  return /^(create|edit|update|delete|remove|add|transition|post|send|write|set|move|assign|comment)/i.test(
    last,
  );
}

/**
 * The answer Claude gives (`--json-schema`): a title, or null and the tool it
 * missed. A tool that isn't offered at all can't be refused, so without this
 * Claude would explain in prose, and the explanation would pass for a title.
 */
export const LOOKUP_ANSWER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    title: {
      type: ['string', 'null'],
      description: "The task's title only, or null when you couldn't find it",
    },
    missingTool: {
      type: ['string', 'null'],
      description: "The exact name of a tool you needed but didn't have, else null",
    },
    reason: {
      type: ['string', 'null'],
      description: 'When title is null: in one sentence, why you could not find it; else null',
    },
  },
  required: ['title', 'missingTool'],
});

/** A tool name as Claude Code's permission rules write it, or null. */
const toolName = (text: unknown) => {
  if (typeof text !== 'string') return null;
  const name = text.trim().replace(/\s+tool$/i, '');
  return /^(mcp__[\w-]+|[A-Z][A-Za-z]+)$/.test(name) ? name : null;
};

/**
 * The arguments of `claude` for a prompt lookup (spec §13.7): print mode, the
 * lookup's model if it names one (else the profile's), the risky built-ins
 * denied in a `--settings` JSON, its rules allowed and anything else refused
 * without asking (`dontAsk`), a structured answer, JSON output to see what was
 * refused, nothing kept. Neither `--tools` nor `--disallowedTools`: both can
 * hide connector tools.
 */
export function claudeLookupArgs(
  lookup: Extract<TaskLookup, { kind: 'prompt' }>,
  prompt: string,
  pluginDirs: string[],
): string[] {
  const deny = deniedTools(lookup.tools);
  return [
    '-p',
    prompt,
    ...(lookup.model ? ['--model', lookup.model] : []),
    ...(deny.length > 0 ? ['--settings', JSON.stringify({ permissions: { deny } })] : []),
    ...(lookup.tools.length > 0 ? ['--allowedTools', lookup.tools.join(',')] : []),
    '--permission-mode',
    'dontAsk',
    '--output-format',
    'json',
    '--json-schema',
    LOOKUP_ANSWER_SCHEMA,
    '--no-session-persistence',
    ...pluginDirs.flatMap((dir) => ['--plugin-dir', dir]),
  ];
}

/** Reads `claude -p --output-format json`'s result (spec §13.7). */
export function parseClaudeLookup(stdout: string, id: string): LookupResult {
  let result: {
    result?: unknown;
    structured_output?: { title?: unknown; missingTool?: unknown; reason?: unknown } | null;
    is_error?: unknown;
    permission_denials?: { tool_name?: unknown }[];
  };
  try {
    result = JSON.parse(stdout.trim().split('\n').pop() ?? '');
  } catch {
    return lookupFailed("Claude's answer couldn't be read");
  }
  const refused = [
    ...new Set(
      (Array.isArray(result.permission_denials) ? result.permission_denials : [])
        .map((d) => d?.tool_name)
        .filter((n): n is string => typeof n === 'string'),
    ),
  ];
  if (refused.length > 0) {
    return lookupFailed(`Claude wasn't allowed to use ${refused.join(', ')}`, refused);
  }
  const text = typeof result.result === 'string' ? result.result : '';
  if (result.is_error === true) return lookupFailed(`Claude: ${text.trim() || 'an error'}`);
  let answer = result.structured_output;
  if (!answer) {
    try {
      answer = JSON.parse(text);
    } catch {
      answer = null;
    }
  }
  if (!answer || typeof answer !== 'object')
    return lookupFailed("Claude's answer couldn't be read");
  const missing = toolName(answer.missingTool);
  if (missing) {
    return lookupFailed(`Claude needed ${missing}, which it isn't allowed to use`, [missing]);
  }
  const title = typeof answer.title === 'string' ? cleanTitle(answer.title, id) : null;
  return title
    ? { ok: true, title }
    : lookupNotFound('Claude found no title', explanation(answer.reason, text));
}

/** Longer explanations are cut. */
const MAX_DETAIL = 300;

/**
 * Claude's own words on why it found no title: the answer's reason, else its
 * result text unless that is only the structured answer again; shortened.
 */
function explanation(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const text = candidate.replace(/\s+/g, ' ').trim();
    if (!text || /^[{[]/.test(text)) continue;
    return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL).trimEnd()}…` : text;
  }
  return undefined;
}
