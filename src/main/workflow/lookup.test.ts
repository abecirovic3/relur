import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type LookupContext, TaskLookupService } from './lookup';

let root: string;
let service: TaskLookupService;

const script = (name: string, body: string) => {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lookup-'));
  const context: LookupContext = {
    shell: '/bin/sh',
    env: { PATH: `${root}:${process.env.PATH}`, HOME: root },
    cwd: root,
    // A stand-in for Claude: answers with the JSON of `claude -p --output-format json`.
    claudeCommand: script(
      'claude',
      `case "$2" in
  *FAKE-1*) echo '{"type":"result","is_error":false,"result":"","structured_output":{"title":"Fix the login","missingTool":null},"permission_denials":[]}' ;;
  *FAKE-2*) echo '{"type":"result","is_error":false,"result":"NO","permission_denials":[{"tool_name":"mcp__tracker__get_issue"}]}' ;;
  *) exit 1 ;;
esac`,
    ),
    pluginDirs: [],
  };
  service = new TaskLookupService(async () => context);
});

afterEach(() => {
  service.dispose();
  fs.rmSync(root, { recursive: true, force: true });
});

const run = (taskId: string, lookup: Parameters<TaskLookupService['run']>[0]['lookup']) =>
  service.run({ requestId: taskId, profileId: 'p', projectId: null, taskId, lookup });
const prompt = {
  kind: 'prompt' as const,
  prompt: 'Title of {id}',
  model: 'haiku',
  tools: [],
  timeoutSec: 10,
};

describe('TaskLookupService', () => {
  it('runs a command with the id quoted, and reads its first line', async () => {
    script(
      'tracker',
      `[ "$1" = "FAKE-1" ] && echo "FAKE-1: Fix the login" || { echo "no such task" >&2; exit 2; }`,
    );
    expect(
      await run('FAKE-1', { kind: 'command', command: 'tracker {id}', timeoutSec: 10 }),
    ).toEqual({ ok: true, title: 'Fix the login' });
    expect(
      await run('FAKE-9', { kind: 'command', command: 'tracker {id}', timeoutSec: 10 }),
    ).toEqual({ ok: false, message: 'The lookup failed (exit 2): no such task', refused: [] });
    expect(await run('FAKE-1', { kind: 'command', command: 'true', timeoutSec: 10 })).toMatchObject(
      {
        message: 'The lookup printed nothing',
      },
    );
  });

  it('stops a lookup after its timeout and on Cancel', async () => {
    const slow = { kind: 'command' as const, command: 'sleep 30', timeoutSec: 5 };
    const started = Date.now();
    const cancelled = run('FAKE-1', slow);
    setTimeout(() => service.cancel('FAKE-1'), 200);
    expect(await cancelled).toMatchObject({ ok: false, message: 'Cancelled' });
    expect(Date.now() - started).toBeLessThan(3000);
    expect(
      await service.run({
        requestId: 'r',
        profileId: 'p',
        projectId: null,
        taskId: 'FAKE-1',
        lookup: { ...slow, timeoutSec: 5, command: 'sleep 30' },
      }),
    ).toMatchObject({ message: 'The lookup timed out after 5 s' });
  }, 15_000);

  it("asks Claude, and names the tool it wasn't allowed", async () => {
    expect(await run('FAKE-1', prompt)).toEqual({ ok: true, title: 'Fix the login' });
    expect(await run('FAKE-2', prompt)).toMatchObject({
      ok: false,
      refused: ['mcp__tracker__get_issue'],
    });
    expect(await run('FAKE-3', prompt)).toMatchObject({ ok: false, message: /exit 1/ });
  });
});
