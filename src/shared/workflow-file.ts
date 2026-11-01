import { BRAND } from './brand';
import { type Workflow, WorkflowSchema, type WorkflowStatus } from './schemas';

/**
 * A workflow shared as a file (spec §13.9): Export writes it, Import reads it,
 * and a skill source carrying one at its root offers it. It holds only the
 * workflow: nothing of the profile (its task lookup, account or environment).
 */

/** The file a skill source carries at its root, and Export's suggested name. */
export const WORKFLOW_FILE = `${BRAND.slug}-workflow.json`;
const KIND = `${BRAND.slug}-workflow`;
const VERSION = 1;

/** The workflow as the file holds it: unset optional fields left out. */
function portable(workflow: Workflow): Workflow {
  const parsed = WorkflowSchema.parse(workflow);
  return JSON.parse(
    JSON.stringify(parsed, (_key, value) => (value === null ? undefined : value)),
  ) as Workflow;
}

/** The file's text. */
export function workflowFileText(workflow: Workflow): string {
  return `${JSON.stringify({ kind: KIND, version: VERSION, workflow: portable(workflow) }, null, 2)}\n`;
}

export type WorkflowFileRead = { ok: true; workflow: Workflow } | { ok: false; message: string };

/** Reads a workflow file's text; says what's wrong in words when it can't. */
export function parseWorkflowFile(text: string): WorkflowFileRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: "It isn't valid JSON." };
  }
  const file = data as { kind?: unknown; version?: unknown; workflow?: unknown } | null;
  if (!file || typeof file !== 'object' || file.kind !== KIND) {
    return { ok: false, message: `It isn't a ${BRAND.displayName} workflow file.` };
  }
  if (typeof file.version !== 'number' || file.version > VERSION) {
    return {
      ok: false,
      message: `It was written by a newer ${BRAND.displayName}; update the app to read it.`,
    };
  }
  const parsed = WorkflowSchema.safeParse(file.workflow);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, message: `Its workflow isn't usable (${where}${issue?.message}).` };
  }
  return { ok: true, workflow: parsed.data };
}

const KIND_TEXT: Record<WorkflowStatus['kind'], string> = {
  step: 'Step',
  gate: 'Gate',
  final: 'Final',
};

const quote = (text: string | null | undefined) => (text ? `"${text}"` : 'none');

/**
 * What replacing `current` with `next` changes, one line each, in words: the
 * statuses (added, removed, relabelled, other kind, hints and answer buttons),
 * their order, the prompts and the fields. Empty when they're the same.
 */
export function workflowChanges(current: Workflow, next: Workflow): string[] {
  const lines: string[] = [];
  const field = (label: string, a: unknown, b: unknown) => {
    if ((a ?? null) !== (b ?? null))
      lines.push(`${label}: ${quote(a as string)} → ${quote(b as string)}`);
  };
  field('Status file', current.file, next.file);
  if (current.match.field !== next.match.field || current.match.equals !== next.match.equals) {
    const text = (w: Workflow) =>
      `${w.match.field} = ${w.match.equals === 'taskId' ? 'task id' : 'branch'}`;
    lines.push(`Which file: ${text(current)} → ${text(next)}`);
  }
  field('Status field', current.statusField, next.statusField);
  field('Task id field', current.idField, next.idField);
  field('Title field', current.titleField, next.titleField);
  field('Document label', current.documentLabel, next.documentLabel);

  const before = new Map(current.statuses.map((s) => [s.value, s]));
  const after = new Map(next.statuses.map((s) => [s.value, s]));
  for (const s of current.statuses) {
    if (after.has(s.value)) continue;
    const lost = [s.hint ? 'its hint' : null, s.answer ? 'its answer button' : null].filter(
      Boolean,
    );
    lines.push(
      `Removes ${s.label} (${s.value})${lost.length ? `, with ${lost.join(' and ')}` : ''}`,
    );
  }
  for (const s of next.statuses) {
    const old = before.get(s.value);
    if (!old) {
      lines.push(`Adds ${s.label} (${s.value}, ${KIND_TEXT[s.kind]})`);
      continue;
    }
    const name = old.label;
    if (old.label !== s.label) lines.push(`${name}: label → "${s.label}"`);
    if (old.kind !== s.kind) lines.push(`${name}: ${KIND_TEXT[old.kind]} → ${KIND_TEXT[s.kind]}`);
    if ((old.hint ?? null) !== (s.hint ?? null)) {
      lines.push(
        s.hint
          ? `${name}: hint ${quote(old.hint)} → ${quote(s.hint)}`
          : `${name}: removes the hint ${quote(old.hint)}`,
      );
    }
    const answer = (a: WorkflowStatus['answer']) => (a ? `${a.label} → ${a.prompt}` : null);
    if (answer(old.answer) !== answer(s.answer)) {
      lines.push(
        s.answer
          ? `${name}: answer button ${quote(answer(old.answer))} → ${quote(answer(s.answer))}`
          : `${name}: removes the answer button ${quote(answer(old.answer))}`,
      );
    }
  }
  const order = (w: Workflow) =>
    w.statuses.map((s) => s.value).filter((v) => before.has(v) && after.has(v));
  if (order(current).join('\n') !== order(next).join('\n')) {
    lines.push(`Order: ${next.statuses.map((s) => s.label).join(' › ')}`);
  }
  field('Start prompt', current.startPrompt, next.startPrompt);
  field('Continue prompt', current.continuePrompt, next.continuePrompt);
  return lines;
}
