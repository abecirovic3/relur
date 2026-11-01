import { describe, expect, it } from 'vitest';
import {
  claudeProposalArgs,
  connectorToolPrefix,
  PROPOSAL_DENIED_TOOLS,
  type ProposalCheck,
  parseMcpList,
  parseProposal,
  patternMatches,
  proposalPrompt,
} from './proposal';

const check: ProposalCheck = {
  statusFile: 'docs/specs/login/specification.md',
  fields: { branch: 'ABC-1-login', task: 'ABC-1', status: 'spec-review', title: 'Login' },
  branch: 'ABC-1-login',
  taskId: 'ABC-1',
  connectors: ['tracker', 'claude.ai Tracker Cloud'],
};

/** `claude -p --output-format json`'s last line with this structured answer. */
const output = (answer: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
  `${JSON.stringify({ type: 'result', result: '', structured_output: answer, ...extra })}\n`;

const good = {
  file: 'docs/specs/*/specification.md',
  matchField: 'branch',
  matchEquals: 'branch',
  statusField: 'status',
  idField: 'task',
  titleField: 'title',
  documentLabel: 'Spec',
  statuses: [
    { value: 'drafting', label: 'Drafting', kind: 'step', hint: null },
    {
      value: 'spec-review',
      label: 'Spec review',
      kind: 'gate',
      hint: 'Review and approve the spec',
      answerLabel: 'Approve spec',
      answerPrompt: 'I approve the spec.',
    },
    { value: 'building', label: 'Building', kind: 'step', answerLabel: 'x', answerPrompt: 'y' },
    { value: 'done', label: 'Done', kind: 'final' },
  ],
  startPrompt: '/team:run-task {id} {title}',
  continuePrompt: '/team:run-task {id} continue',
  lookupTool: 'mcp__tracker__get_issue',
  undetermined: [],
};

describe('parseProposal', () => {
  it('turns a full answer into a workflow and a lookup', () => {
    const result = parseProposal(output(good), check);
    expect(result).toEqual({
      ok: true,
      proposal: {
        workflow: {
          file: 'docs/specs/*/specification.md',
          match: { field: 'branch', equals: 'branch' },
          idField: 'task',
          titleField: 'title',
          statusField: 'status',
          documentLabel: 'Spec',
          statuses: [
            { value: 'drafting', label: 'Drafting', kind: 'step', hint: null, answer: null },
            {
              value: 'spec-review',
              label: 'Spec review',
              kind: 'gate',
              hint: 'Review and approve the spec',
              answer: { label: 'Approve spec', prompt: 'I approve the spec.' },
            },
            // An answer button only on a gate.
            { value: 'building', label: 'Building', kind: 'step', hint: null, answer: null },
            { value: 'done', label: 'Done', kind: 'final', hint: null, answer: null },
          ],
          startPrompt: '/team:run-task {id} {title}',
          continuePrompt: '/team:run-task {id} continue',
        },
        lookup: {
          kind: 'prompt',
          prompt: expect.stringContaining('{id}'),
          tools: ['mcp__tracker__get_issue'],
          timeoutSec: 60,
        },
        undetermined: [],
      },
    });
  });

  it('accepts a claude.ai connector by its spelled-out name', () => {
    const result = parseProposal(
      output({ ...good, lookupTool: 'mcp__claude_ai_Tracker_Cloud__getIssue' }),
      check,
    );
    expect(
      result.ok && result.proposal.lookup?.kind === 'prompt' && result.proposal.lookup.tools,
    ).toEqual(['mcp__claude_ai_Tracker_Cloud__getIssue']);
  });

  it('refuses a lookup tool that changes things or belongs to no connector', () => {
    for (const tool of ['mcp__tracker__update_issue', 'mcp__other__get_issue', 'Bash']) {
      const result = parseProposal(output({ ...good, lookupTool: tool }), check);
      expect(result.ok && result.proposal.lookup).toBeNull();
      expect(result.ok && result.proposal.undetermined).toEqual([
        `The task lookup: ${tool} isn't a read tool of a connected connector.`,
      ]);
    }
  });

  it('checks the answer against the status file and says what it fell back to', () => {
    const result = parseProposal(
      output({
        file: 'specs/*.md',
        matchField: 'ticket',
        matchEquals: 'branch',
        statusField: 'phase',
        idField: 'missing',
        titleField: null,
        documentLabel: null,
        statuses: [
          { value: 'drafting', label: 'Drafting', kind: 'step' },
          { value: 'drafting', label: 'Again', kind: 'gate' },
          { value: 'building', label: 'Building', kind: 'wait' },
        ],
        startPrompt: null,
        continuePrompt: null,
        lookupTool: null,
        undetermined: ['Whether building is a gate: the skill does not say.'],
      }),
      check,
    );
    if (!result.ok) throw new Error(result.message);
    const { workflow, undetermined } = result.proposal;
    expect(workflow).toMatchObject({
      file: 'docs/specs/login/specification.md',
      match: { field: 'branch', equals: 'branch' },
      statusField: 'status',
      idField: null,
      continuePrompt: 'Continue with {id}. Its status is {status}.',
    });
    expect(workflow.statuses.map((s) => [s.value, s.kind])).toEqual([
      ['drafting', 'step'],
      ['building', 'step'],
    ]);
    expect(undetermined).toEqual([
      'Whether building is a gate: the skill does not say.',
      "The pattern specs/*.md doesn't match docs/specs/login/specification.md; it's set to that file alone.",
      'The status field: status is a guess from the file.',
      'Which status is final.',
      "The status file says spec-review, which isn't among the statuses found.",
      'The Start prompt: no skill was found that starts the workflow.',
      "The task lookup: none of the profile's connectors has a tool that reads an issue.",
    ]);
  });

  it('finds the match field by the task id when no field holds the branch', () => {
    const result = parseProposal(output({ ...good, matchField: null }), {
      ...check,
      fields: { task: 'ABC-1', status: 'done' },
    });
    expect(result.ok && result.proposal.workflow.match).toEqual({
      field: 'task',
      equals: 'taskId',
    });
  });

  it('refuses a pattern that leaves the worktree', () => {
    const result = parseProposal(output({ ...good, file: '../other/*.md' }), check);
    expect(result.ok && result.proposal.workflow.file).toBe(check.statusFile);
  });

  it("says why there's no proposal", () => {
    expect(parseProposal('not json', check)).toEqual({
      ok: false,
      message: "Claude's answer couldn't be read",
    });
    expect(parseProposal(output(null, { is_error: true, result: 'Credit low' }), check)).toEqual({
      ok: false,
      message: 'Claude: Credit low',
    });
    expect(parseProposal(output(null, { result: 'I could not read the skills.' }), check)).toEqual({
      ok: false,
      message: "Claude didn't propose a workflow",
      detail: 'I could not read the skills.',
    });
  });
});

describe('the proposal run', () => {
  const input = {
    skillDir: '/skills/team',
    skillNames: ['/team:run-task'],
    statusFile: check.statusFile,
    branch: check.branch,
    taskId: check.taskId,
    connectors: ['tracker'],
  };

  it('reads only: risky built-ins denied, file readers kept, nothing allowed beyond', () => {
    const args = claudeProposalArgs(input, { model: 'haiku' });
    expect(PROPOSAL_DENIED_TOOLS).toEqual(
      expect.arrayContaining(['Bash', 'Edit', 'Write', 'WebFetch', 'WebSearch', 'Agent', 'Skill']),
    );
    expect(PROPOSAL_DENIED_TOOLS).not.toContain('Read');
    expect(JSON.parse(args[args.indexOf('--settings') + 1] as string)).toEqual({
      permissions: { deny: PROPOSAL_DENIED_TOOLS },
    });
    expect(args[args.indexOf('--add-dir') + 1]).toBe('/skills/team');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    for (const flag of [
      '--allowedTools',
      '--plugin-dir',
      '--tools',
      '--dangerously-skip-permissions',
    ]) {
      expect(args).not.toContain(flag);
    }
    expect(args).toContain('--no-session-persistence');
    expect(claudeProposalArgs(input, { model: null })).not.toContain('--model');
  });

  it('tells Claude where things are, and no names of its own', () => {
    const prompt = proposalPrompt(input);
    expect(prompt).toContain('/skills/team');
    expect(prompt).toContain('/team:run-task');
    expect(prompt).toContain(check.statusFile);
    expect(prompt).toContain('connectors: tracker');
    expect(proposalPrompt({ ...input, connectors: [] })).toContain('no connectors');
  });
});

describe('connectors', () => {
  it('reads the connected servers from claude mcp list', () => {
    const listed = [
      'Checking MCP server health...',
      '',
      'tracker: npx tracker-mcp - ✓ Connected',
      'claude.ai Tracker Cloud: https://mcp.example.com/sse (HTTP) - ✓ Connected',
      'broken: node server.js - ✗ Failed to connect',
      'claude.ai Mail: https://mail.example.com - ! Needs authentication',
      'claude.ai Docs: https://docs.example.com/mcp - ✔ Connected',
      'local: http://127.0.0.1:1/stream (HTTP) - ✘ Failed to connect — ECONNREFUSED',
    ].join('\n');
    expect(parseMcpList(listed)).toEqual(['tracker', 'claude.ai Tracker Cloud', 'claude.ai Docs']);
    expect(parseMcpList('No MCP servers configured.')).toEqual([]);
  });

  it('spells server names as tool names do', () => {
    expect(connectorToolPrefix('claude.ai Tracker Cloud')).toBe('mcp__claude_ai_Tracker_Cloud__');
    expect(connectorToolPrefix('tracker')).toBe('mcp__tracker__');
  });

  it('matches patterns segment by segment', () => {
    expect(patternMatches('docs/specs/*/specification.md', check.statusFile)).toBe(true);
    expect(patternMatches('docs/*/specification.md', check.statusFile)).toBe(false);
    expect(patternMatches('docs/specs/*/*.md', check.statusFile)).toBe(true);
  });
});
