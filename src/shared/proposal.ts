import { isConnectorTool, LOOKUP_DENIED_TOOLS, looksLikeWriteTool } from './lookup';
import {
  DEFAULT_CONTINUE_PROMPT,
  DEFAULT_LOOKUP_PROMPT,
  type TaskLookup,
  type Workflow,
  WorkflowSchema,
  type WorkflowStatus,
} from './schemas';
import { segmentMatches } from './workflow';

/**
 * Set up from my skills (spec §13.10): the profile's Claude reads a skill
 * source and a worktree that has a status file, without changing anything,
 * and proposes the whole workflow. The proposal fills the form; nothing is
 * saved until the user saves it.
 */

/** Front matter fields that hold a status, for finding status files. */
export const STATUS_FIELD_NAMES = ['status', 'state', 'phase', 'stage'];

/**
 * Tools the proposal denies: the risky built-ins except the ones that only
 * read files (Read, Glob, Grep). Those stay, and Claude Code lets them read
 * only inside the working folders (the worktree and the skill source):
 * anything outside would need asking, which `dontAsk` refuses.
 */
export const PROPOSAL_DENIED_TOOLS = LOOKUP_DENIED_TOOLS.filter(
  (t) => !['Read', 'Glob', 'Grep'].includes(t),
);

/** What Claude is told about where things are. */
export interface ProposalInput {
  /** The skill source's folder. */
  skillDir: string;
  /** How its skills are invoked: `/plugin:skill`. */
  skillNames: string[];
  /** The status file found in the worktree, relative to it. */
  statusFile: string;
  branch: string;
  taskId: string | null;
  /** The profile's connectors' server names, as tool names spell them. */
  connectors: string[];
}

/** The answer Claude gives (`--json-schema`). */
export const PROPOSAL_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    file: { type: ['string', 'null'] },
    matchField: { type: ['string', 'null'] },
    matchEquals: { type: ['string', 'null'], enum: ['branch', 'taskId', null] },
    statusField: { type: ['string', 'null'] },
    idField: { type: ['string', 'null'] },
    titleField: { type: ['string', 'null'] },
    documentLabel: { type: ['string', 'null'] },
    statuses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          label: { type: 'string' },
          kind: { type: 'string', enum: ['step', 'gate', 'final'] },
          hint: { type: ['string', 'null'] },
          answerLabel: { type: ['string', 'null'] },
          answerPrompt: { type: ['string', 'null'] },
        },
        required: ['value', 'label', 'kind'],
      },
    },
    startPrompt: { type: ['string', 'null'] },
    continuePrompt: { type: ['string', 'null'] },
    lookupTool: { type: ['string', 'null'] },
    undetermined: { type: 'array', items: { type: 'string' } },
  },
  required: ['statuses', 'undetermined'],
});

/** The prompt (spec §13.10). Generic: it names no team, tracker or tool. */
export function proposalPrompt(input: ProposalInput): string {
  const skills = input.skillNames.length
    ? `They load as ${input.skillNames.join(', ')}.`
    : 'Their plugin and skill names are in their folders.';
  const connectors = input.connectors.length
    ? `This profile has these connectors: ${input.connectors.join(', ')}. If one of them is an issue tracker, give lookupTool: the exact name of its one tool that reads a single issue by its key, as mcp__<server>__<tool>. You may use ToolSearch to see tool names, but never call a connector's tool. If none fits, null.`
    : 'This profile has no connectors: lookupTool is null.';
  return [
    "You are helping set up a workflow in a desktop app that runs Claude Code in git worktrees. A team's skills take a task through statuses and keep its current status in the front matter of a Markdown file in the worktree. Work out how, by reading files only. Change nothing.",
    '',
    `The skills are in ${input.skillDir}. ${skills} Read their SKILL.md files and what they refer to, to find the workflow skill and the statuses it writes.`,
    `The current folder is the worktree of a task in progress. Its status file is ${input.statusFile}. Its branch is ${input.branch}; its task id is ${input.taskId ?? 'unknown'}.`,
    '',
    'Give:',
    '- file: a pattern, relative to the worktree, matching the status file of every task; * stands for any part of one folder or file name (for example docs/specs/*/specification.md).',
    '- matchField and matchEquals: the front matter field that tells which file is this task\'s, and whether it equals the branch ("branch") or the task id ("taskId").',
    '- statusField, idField, titleField: the front matter fields holding the status, the task id and the title (null when there is none).',
    '- statuses: every status in the order the skills move through them: value exactly as written in the file, a short label, and kind: "gate" where a skill stops and waits for a person\'s decision, "final" for the end, "step" otherwise. For a gate, hint: what the person should do, as a short imperative; answerLabel: a short button label for the approval; answerPrompt: the sentence the person would type to the skill to approve. Null for the others.',
    '- startPrompt: the message that starts the workflow skill for a new task, invoking it as /<plugin>:<skill> with {id} and {title}. continuePrompt: the message that tells it to go on at a step, with {id} and {status}.',
    '- documentLabel: a one-word name for a tab showing the status file, like Spec.',
    `- ${connectors}`,
    '- undetermined: one short line for each thing you could not determine, saying why.',
    '',
    'Use null for anything you could not determine from the files, and list it under undetermined. Do not make up values the files do not support.',
  ].join('\n');
}

/**
 * The arguments of `claude` for a proposal: print mode, the risky built-ins
 * denied (file-reading ones stay, limited to the working folders), the skill
 * source added as a working folder, anything else refused without asking,
 * the structured answer, nothing kept. No plugins: the skills are read as
 * files, never run.
 */
export function claudeProposalArgs(
  input: ProposalInput,
  options: { model?: string | null },
): string[] {
  return [
    '-p',
    proposalPrompt(input),
    ...(options.model ? ['--model', options.model] : []),
    '--settings',
    JSON.stringify({ permissions: { deny: PROPOSAL_DENIED_TOOLS } }),
    '--add-dir',
    input.skillDir,
    '--permission-mode',
    'dontAsk',
    '--output-format',
    'json',
    '--json-schema',
    PROPOSAL_SCHEMA,
    '--no-session-persistence',
  ];
}

/** A connector's server name as tool names spell it (`claude.ai Tracker` → `claude_ai_Tracker`). */
export const connectorToolPrefix = (server: string) =>
  `mcp__${server.trim().replace(/[^A-Za-z0-9_-]/g, '_')}__`;

/**
 * The connected servers in `claude mcp list`'s output: lines like
 * `name: <command or url> - ✔ Connected` (✓ in some versions). Others (failed, needing sign-in)
 * are left out: their tools can't be used.
 */
export function parseMcpList(output: string): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(.+?):\s.*\s-\s*[✓✔]?\s*Connected\s*$/.exec(line.trim());
    if (m?.[1]) names.push(m[1].trim());
  }
  return [...new Set(names)];
}

/** What the proposal gave: a draft workflow, maybe a task lookup, and what's missing. */
export interface Proposal {
  workflow: Workflow;
  /** A lookup through the connector tool Claude named, when it named a usable one. */
  lookup: TaskLookup | null;
  /** What couldn't be determined, in words, Claude's and the app's own checks. */
  undetermined: string[];
}

export type ProposalResult =
  | { ok: true; proposal: Proposal }
  | { ok: false; message: string; detail?: string };

/** What the app knows to check Claude's answer against. */
export interface ProposalCheck {
  statusFile: string;
  /** The status file's front matter. */
  fields: Record<string, unknown>;
  branch: string;
  taskId: string | null;
  connectors: string[];
}

const text = (value: unknown, max = 2000): string | null => {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t && t.length <= max ? t : null;
};

const fieldValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : null;

/** Whether a worktree-relative pattern matches a file, segment by segment. */
export function patternMatches(pattern: string, file: string): boolean {
  const p = pattern.split('/').filter(Boolean);
  const f = file.split('/').filter(Boolean);
  return p.length === f.length && p.every((s, i) => segmentMatches(s, f[i] as string));
}

/** Reads Claude's answer and checks it against the status file (spec §13.10). */
export function parseProposal(stdout: string, check: ProposalCheck): ProposalResult {
  let result: {
    result?: unknown;
    structured_output?: Record<string, unknown> | null;
    is_error?: unknown;
  };
  try {
    result = JSON.parse(stdout.trim().split('\n').pop() ?? '');
  } catch {
    return { ok: false, message: "Claude's answer couldn't be read" };
  }
  const said = typeof result.result === 'string' ? result.result.trim() : '';
  if (result.is_error === true) return { ok: false, message: `Claude: ${said || 'an error'}` };
  let answer = result.structured_output;
  if (!answer) {
    try {
      answer = JSON.parse(said);
    } catch {
      answer = null;
    }
  }
  if (!answer || typeof answer !== 'object') {
    return {
      ok: false,
      message: "Claude didn't propose a workflow",
      ...(said ? { detail: said.slice(0, 400) } : {}),
    };
  }
  const undetermined = (Array.isArray(answer.undetermined) ? answer.undetermined : [])
    .map((u) => text(u, 300))
    .filter((u): u is string => u !== null);
  const note = (line: string) => undetermined.push(line);

  // The status file's pattern must be relative, stay in the worktree and match the file found.
  let file = text(answer.file, 300);
  if (file && (file.startsWith('/') || file.split('/').includes('..'))) file = null;
  if (file && !patternMatches(file, check.statusFile)) {
    note(`The pattern ${file} doesn't match ${check.statusFile}; it's set to that file alone.`);
    file = null;
  } else if (!file) {
    note(`A pattern for every task's status file: it's set to ${check.statusFile} alone.`);
  }
  file ??= check.statusFile;

  const has = (field: string | null) => field !== null && field in check.fields;
  let statusField = text(answer.statusField, 100);
  if (!has(statusField)) {
    statusField = STATUS_FIELD_NAMES.find((f) => f in check.fields) ?? 'status';
    note(`The status field: ${statusField} is a guess from the file.`);
  }
  const idField = has(text(answer.idField, 100)) ? text(answer.idField, 100) : null;
  const titleField = has(text(answer.titleField, 100)) ? text(answer.titleField, 100) : null;

  let matchField = text(answer.matchField, 100);
  let equals: 'branch' | 'taskId' = answer.matchEquals === 'taskId' ? 'taskId' : 'branch';
  const wanted = equals === 'branch' ? check.branch : check.taskId;
  if (!has(matchField) || fieldValue(check.fields[matchField as string]) !== wanted) {
    const byBranch = Object.keys(check.fields).find(
      (k) => fieldValue(check.fields[k]) === check.branch,
    );
    const byId = check.taskId
      ? Object.keys(check.fields).find((k) => fieldValue(check.fields[k]) === check.taskId)
      : undefined;
    if (byBranch) [matchField, equals] = [byBranch, 'branch'];
    else if (byId) [matchField, equals] = [byId, 'taskId'];
    else {
      matchField = 'branch';
      equals = 'branch';
      note(
        "Which file is the workspace's: no field of the status file holds its branch or task id.",
      );
    }
  }

  const seen = new Set<string>();
  const statuses: WorkflowStatus[] = [];
  for (const raw of Array.isArray(answer.statuses) ? answer.statuses : []) {
    const s = raw as Record<string, unknown>;
    const value = text(s?.value, 100);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const kind = s.kind === 'gate' || s.kind === 'final' ? s.kind : 'step';
    const answerLabel = kind === 'gate' ? text(s.answerLabel, 60) : null;
    const answerPrompt = kind === 'gate' ? text(s.answerPrompt, 1000) : null;
    statuses.push({
      value,
      label: text(s.label, 60) ?? value,
      kind,
      hint: text(s.hint, 200),
      answer: answerLabel && answerPrompt ? { label: answerLabel, prompt: answerPrompt } : null,
    });
  }
  if (statuses.length === 0) note('The statuses: none were found in the skills.');
  else if (!statuses.some((s) => s.kind === 'final')) note('Which status is final.');
  const current = fieldValue(check.fields[statusField as string]);
  if (statuses.length > 0 && current && !seen.has(current)) {
    note(`The status file says ${current}, which isn't among the statuses found.`);
  }

  const startPrompt = text(answer.startPrompt);
  if (!startPrompt) note('The Start prompt: no skill was found that starts the workflow.');

  let lookup: TaskLookup | null = null;
  const tool = text(answer.lookupTool, 200);
  if (tool) {
    const usable =
      isConnectorTool(tool) &&
      /^mcp__[\w-]+__[\w-]+$/.test(tool) &&
      check.connectors.some((c) => tool.startsWith(connectorToolPrefix(c))) &&
      !looksLikeWriteTool(tool);
    if (usable) {
      lookup = { kind: 'prompt', prompt: DEFAULT_LOOKUP_PROMPT, tools: [tool], timeoutSec: 60 };
    } else {
      note(`The task lookup: ${tool} isn't a read tool of a connected connector.`);
    }
  } else if (check.connectors.length > 0) {
    note("The task lookup: none of the profile's connectors has a tool that reads an issue.");
  }

  const workflow = WorkflowSchema.parse({
    file,
    match: { field: matchField, equals },
    idField,
    titleField,
    statusField,
    documentLabel: text(answer.documentLabel, 40),
    statuses,
    startPrompt,
    continuePrompt: text(answer.continuePrompt) ?? DEFAULT_CONTINUE_PROMPT,
  });
  return { ok: true, proposal: { workflow, lookup, undetermined: [...new Set(undetermined)] } };
}
