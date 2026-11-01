import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import { type Workflow, WorkflowSchema } from './schemas';
import {
  parseWorkflowFile,
  WORKFLOW_FILE,
  workflowChanges,
  workflowFileText,
} from './workflow-file';

const workflow: Workflow = WorkflowSchema.parse({
  file: 'docs/specs/*/specification.md',
  titleField: 'title',
  statuses: [
    { value: 'draft', label: 'Draft' },
    {
      value: 'spec-review',
      label: 'Spec review',
      kind: 'gate',
      hint: 'Review and approve the spec',
      answer: { label: 'Approve spec', prompt: 'I approve the spec.' },
    },
    { value: 'building', label: 'Building' },
    { value: 'done', label: 'Done', kind: 'final' },
  ],
  startPrompt: '/team:start {id} {title}',
});

describe('the workflow file', () => {
  it('is named after the app', () => {
    expect(WORKFLOW_FILE).toBe(`${BRAND.slug}-workflow.json`);
  });

  it('round-trips a workflow, leaving out unset fields', () => {
    const text = workflowFileText(workflow);
    const data = JSON.parse(text);
    expect(data.kind).toBe(`${BRAND.slug}-workflow`);
    expect(data.version).toBe(1);
    expect(data.workflow).not.toHaveProperty('idField');
    expect(data.workflow).not.toHaveProperty('documentLabel');
    expect(parseWorkflowFile(text)).toEqual({ ok: true, workflow });
  });

  it('carries nothing of the profile, such as an old lookup kept in the workflow', () => {
    const withLookup = { ...workflow, lookup: { kind: 'command', command: 'x {id}' } } as Workflow;
    expect(JSON.parse(workflowFileText(withLookup)).workflow).not.toHaveProperty('lookup');
  });

  it('fills defaults for fields a hand-written file leaves out', () => {
    const read = parseWorkflowFile(
      JSON.stringify({
        kind: `${BRAND.slug}-workflow`,
        version: 1,
        workflow: { file: 'spec.md', statuses: [{ value: 'a', label: 'A' }] },
      }),
    );
    expect(read).toMatchObject({
      ok: true,
      workflow: { match: { field: 'branch', equals: 'branch' }, statusField: 'status' },
    });
  });

  it('says why a file is unusable', () => {
    const file = (data: unknown) => parseWorkflowFile(JSON.stringify(data));
    expect(parseWorkflowFile('{')).toEqual({ ok: false, message: "It isn't valid JSON." });
    expect(file({ workflow })).toEqual({
      ok: false,
      message: `It isn't a ${BRAND.displayName} workflow file.`,
    });
    expect(file({ kind: `${BRAND.slug}-workflow`, version: 2, workflow })).toMatchObject({
      ok: false,
      message: expect.stringContaining('newer'),
    });
    expect(
      file({
        kind: `${BRAND.slug}-workflow`,
        version: 1,
        workflow: { ...workflow, statuses: [{ value: 'a', label: 'A', kind: 'wait' }] },
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining('statuses.0.kind') });
  });
});

describe('workflowChanges', () => {
  it('is empty for the same workflow', () => {
    expect(workflowChanges(workflow, structuredClone(workflow))).toEqual([]);
  });

  it('names lost hints and answer buttons, and other changes', () => {
    const next: Workflow = {
      ...workflow,
      statuses: [
        { value: 'draft', label: 'Drafting', kind: 'step' },
        { value: 'spec-review', label: 'Spec review', kind: 'gate' },
        { value: 'building', label: 'Building', kind: 'gate', hint: 'Check it' },
        { value: 'released', label: 'Released', kind: 'final' },
      ],
      startPrompt: null,
    };
    expect(workflowChanges(workflow, next)).toEqual([
      'Removes Done (done)',
      'Draft: label → "Drafting"',
      'Spec review: removes the hint "Review and approve the spec"',
      'Spec review: removes the answer button "Approve spec → I approve the spec."',
      'Building: Step → Gate',
      'Building: hint none → "Check it"',
      'Adds Released (released, Final)',
      'Start prompt: "/team:start {id} {title}" → none',
    ]);
  });

  it('names a removed status with its hint and answer, the order and the fields', () => {
    const next: Workflow = {
      ...workflow,
      file: 'specs/*.md',
      match: { field: 'task', equals: 'taskId' },
      statuses: [
        workflow.statuses[2],
        workflow.statuses[0],
        workflow.statuses[3],
      ] as Workflow['statuses'],
    };
    expect(workflowChanges(workflow, next)).toEqual([
      'Status file: "docs/specs/*/specification.md" → "specs/*.md"',
      'Which file: branch = branch → task = task id',
      'Removes Spec review (spec-review), with its hint and its answer button',
      'Order: Building › Draft › Done',
    ]);
  });
});
