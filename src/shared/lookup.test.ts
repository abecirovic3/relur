import { describe, expect, it } from 'vitest';
import {
  claudeLookupArgs,
  cleanTitle,
  deniedTools,
  LOOKUP_DENIED_TOOLS,
  looksLikeWriteTool,
  parseClaudeLookup,
} from './lookup';

describe('cleanTitle', () => {
  it('takes the first line without Markdown, labels, quotes or the id', () => {
    expect(cleanTitle('\n  Fix the login timeout\nmore text', 'ABC-1')).toBe(
      'Fix the login timeout',
    );
    expect(cleanTitle('**Title:** "Fix the login"', 'ABC-1')).toBe('Fix the login');
    expect(cleanTitle('# ABC-1: Fix the login', 'ABC-1')).toBe('Fix the login');
    expect(cleanTitle('ABC-12 stays', 'ABC-1')).toBe('ABC-12 stays');
    expect(cleanTitle('  \n', 'ABC-1')).toBeNull();
    const long = cleanTitle('word '.repeat(80), 'X-1') ?? '';
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith('word')).toBe(true);
  });
});

describe('tools', () => {
  it("denies the risky built-ins its rules don't name, in --settings, and allows its rules", () => {
    expect(deniedTools(['mcp__tracker__get_issue'])).toEqual(LOOKUP_DENIED_TOOLS);
    // A Bash rule needs Bash: a deny would win over it.
    expect(deniedTools(['Bash(tracker view:*)', 'Skill', 'mcp__t'])).toEqual(
      LOOKUP_DENIED_TOOLS.filter((t) => t !== 'Bash' && t !== 'Skill'),
    );
    const args = claudeLookupArgs(
      {
        kind: 'prompt',
        prompt: 'x',
        model: 'haiku',
        tools: ['mcp__tracker', 'Read'],
        timeoutSec: 60,
      },
      'Title of ABC-1',
      ['/skills/a'],
    );
    expect(args.slice(0, 4)).toEqual(['-p', 'Title of ABC-1', '--model', 'haiku']);
    // Neither --tools nor --disallowedTools: both can hide connector tools.
    expect(args).not.toContain('--tools');
    expect(args).not.toContain('--disallowedTools');
    expect(JSON.parse(args[args.indexOf('--settings') + 1] as string)).toEqual({
      permissions: { deny: LOOKUP_DENIED_TOOLS.filter((t) => t !== 'Read') },
    });
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('mcp__tracker,Read');
    expect(args).toContain('dontAsk');
    expect(args.slice(-2)).toEqual(['--plugin-dir', '/skills/a']);
  });

  it("uses the profile's model unless the lookup names one, and allows nothing without a list", () => {
    const args = claudeLookupArgs(
      { kind: 'prompt', prompt: 'x', tools: [], timeoutSec: 60 },
      'T',
      [],
    );
    expect(args).not.toContain('--model');
    expect(args).toContain('--settings');
    expect(args).not.toContain('--allowedTools');
  });

  it('spots tools that change things', () => {
    expect(looksLikeWriteTool('mcp__tracker__getIssue')).toBe(false);
    expect(looksLikeWriteTool('mcp__tracker__editIssue')).toBe(true);
    expect(looksLikeWriteTool('mcp__tracker__transitionIssue')).toBe(true);
    expect(looksLikeWriteTool('Bash')).toBe(true);
    expect(looksLikeWriteTool('Bash(tracker view:*)')).toBe(false);
    expect(looksLikeWriteTool('Read')).toBe(false);
  });
});

describe('parseClaudeLookup', () => {
  const json = (o: object) => JSON.stringify({ type: 'result', is_error: false, ...o });
  const answer = (title: string | null, missingTool: string | null = null) => ({
    structured_output: { title, missingTool },
    permission_denials: [],
  });
  it('reads the title, a missing or refused tool, or an error', () => {
    expect(parseClaudeLookup(json(answer('Fix login')), 'A-1')).toEqual({
      ok: true,
      title: 'Fix login',
    });
    expect(
      parseClaudeLookup(json({ result: '{"title":"From text","missingTool":null}' }), 'A-1'),
    ).toEqual({ ok: true, title: 'From text' });
    expect(parseClaudeLookup(json(answer(null, 'Bash tool')), 'A-1')).toEqual({
      ok: false,
      message: "Claude needed Bash, which it isn't allowed to use",
      refused: ['Bash'],
    });
    expect(parseClaudeLookup(json(answer(null, 'the shell')), 'A-1')).toMatchObject({
      message: 'Claude found no title',
      refused: [],
    });
    expect(
      parseClaudeLookup(
        json({
          result: 'NO',
          permission_denials: [{ tool_name: 'mcp__t__get' }, { tool_name: 'mcp__t__get' }],
        }),
        'A-1',
      ),
    ).toEqual({
      ok: false,
      message: "Claude wasn't allowed to use mcp__t__get",
      refused: ['mcp__t__get'],
    });
    expect(
      parseClaudeLookup(json({ result: 'Rate limited', is_error: true }), 'A-1'),
    ).toMatchObject({ ok: false, message: 'Claude: Rate limited' });
    expect(parseClaudeLookup(json({ result: 'prose' }), 'A-1')).toMatchObject({ ok: false });
  });

  it("shows Claude's own explanation when it finds no title and names no tool", () => {
    const none = (structured: object, result = JSON.stringify(structured)) =>
      parseClaudeLookup(json({ structured_output: structured, result }), 'A-1');
    expect(
      none({ title: null, missingTool: null, reason: 'No tracker tool is available.' }),
    ).toEqual({
      ok: false,
      message: 'Claude found no title',
      refused: [],
      detail: 'No tracker tool is available.',
    });
    // Without a reason: the result text, unless it's only the answer again.
    expect(
      none({ title: null, missingTool: null }, 'I tried   Bash,\n but it is off.'),
    ).toMatchObject({
      detail: 'I tried Bash, but it is off.',
    });
    expect(none({ title: null, missingTool: null })).not.toHaveProperty('detail');
    const long = none({ title: null, missingTool: null, reason: 'word '.repeat(100) });
    expect(long.ok === false && long.detail).toMatch(/^(word ){59}word…$/);
    expect(none({ title: null, missingTool: 'Bash', reason: 'Needs Bash.' })).not.toHaveProperty(
      'detail',
    );
    expect(parseClaudeLookup('not json', 'A-1')).toMatchObject({ ok: false });
  });
});
