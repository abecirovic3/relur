import type { TerminalServerMessage } from '@shared/terminal-protocol';
import { describe, expect, it } from 'vitest';
import { SessionHost, type SpawnOptions, type TerminalSink } from './host';

const env = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  TERM: 'xterm-256color',
  HOME: process.env.HOME ?? '/',
};

function sh(script: string, extra: Partial<SpawnOptions> = {}): SpawnOptions {
  return {
    kind: 'shell',
    title: 'test',
    command: '/bin/sh',
    args: ['-c', script],
    cwd: process.cwd(),
    env,
    profileId: 'work',
    ...extra,
  };
}

function recorder() {
  const messages: TerminalServerMessage[] = [];
  let closed = false;
  const sink: TerminalSink = {
    send: (m) => messages.push(m),
    close: () => {
      closed = true;
    },
  };
  return {
    sink,
    messages,
    get closed() {
      return closed;
    },
    output: () =>
      messages
        .filter((m) => m.type === 'data' || m.type === 'replay')
        .map((m) => ('data' in m ? m.data : ''))
        .join(''),
    exit: () => messages.find((m) => m.type === 'exit'),
  };
}

async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 500; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe('SessionHost', () => {
  it('starts no session once closed for quitting, and still stops the running ones', async () => {
    const host = new SessionHost();
    const running = host.spawn(sh('sleep 5'));
    host.close();
    expect(() => host.spawn(sh('sleep 5'))).toThrow(/Quitting/);
    expect(host.list().map((s) => s.id)).toEqual([running.id]);
    await host.stopAll();
    expect(host.runningCount()).toBe(0);
  });

  it('sends nothing to views once closed, and shutdown waits for every exit', async () => {
    // Ignores the stop signals, prints once quitting began, then gets SIGKILL.
    const host = new SessionHost({ batchMs: 5, killTimeoutMs: 600 });
    const session = host.spawn(sh('trap "" HUP TERM; sleep 0.2; printf late; sleep 5'));
    const view = recorder();
    host.attach(session.id, view.sink);
    const before = view.messages.length;
    await host.shutdown();
    expect(host.get(session.id).status).toBe('exited');
    expect(view.messages.length).toBe(before);
    expect(() => host.spawn(sh('true'))).toThrow(/Quitting/);
  });

  it('keeps marks at their place in the output and sends them with the replay', async () => {
    const host = new SessionHost({ batchMs: 5 });
    const session = host.spawn(sh('printf one; read x; printf two; read y'));
    try {
      await until(() => host.scrollback(session.id) === 'one', 'the first output');
      host.mark(session.id, { kind: 'prompt', text: 'p' });
      const live = recorder();
      const view = host.attach(session.id, live.sink);
      expect(live.messages[0]).toEqual({
        type: 'replay',
        data: 'one',
        marks: [{ at: 3, mark: { kind: 'prompt', text: 'p' } }],
      });
      view.input('\r');
      await until(() => host.scrollback(session.id).endsWith('two'), 'more output');
      host.mark(session.id, { kind: 'response', text: 'r' });
      expect(live.messages.at(-1)).toEqual({ type: 'mark', mark: { kind: 'response', text: 'r' } });
      const later = recorder();
      host.attach(session.id, later.sink);
      const replay = later.messages[0] as { data: string; marks: { at: number }[] };
      expect(replay.marks.map((m) => replay.data.slice(0, m.at).endsWith('one'))).toEqual([
        true,
        false,
      ]);
      expect(replay.data.slice(0, replay.marks[1]?.at)).toMatch(/two$/);
    } finally {
      await host.stopAll();
    }
  });

  it('marks Claude as launching until its first output, or for at most launchMs', async () => {
    const host = new SessionHost({ launchMs: 300 });
    const changes: string[] = [];
    host.onChange(() => changes.push('change'));
    const talks = host.spawn(sh('sleep 0.1; echo hi; sleep 5', { kind: 'claude' }));
    const silent = host.spawn(sh('sleep 5', { kind: 'claude' }));
    const shell = host.spawn(sh('sleep 5'));
    try {
      expect(talks.launching).toBe(true);
      expect(silent.launching).toBe(true);
      expect(shell.launching).toBe(false);
      await until(() => !host.get(talks.id).launching, 'the first output');
      expect(host.get(silent.id).launching).toBe(true);
      await until(() => !host.get(silent.id).launching, 'the launch time to pass');
      expect(changes.length).toBeGreaterThanOrEqual(5);
    } finally {
      await host.stopAll();
    }
  });

  it('streams batched output to attached views and reports the exit', async () => {
    const host = new SessionHost({ batchMs: 50 });
    const session = host.spawn(sh('sleep 0.2; printf a; printf b; printf c; exit 3'));
    const view = recorder();
    host.attach(session.id, view.sink);
    await until(() => !!view.exit(), 'exit');

    expect(view.messages[0]).toEqual({ type: 'replay', data: '' });
    expect(view.output()).toContain('abc');
    // Three writes within one batch window arrive as one message.
    expect(view.messages.filter((m) => m.type === 'data')).toHaveLength(1);
    expect(view.exit()).toEqual({ type: 'exit', exitCode: 3, signal: null });
    expect(host.get(session.id)).toMatchObject({ status: 'exited', exitCode: 3 });
  });

  it('replays the scrollback to a view attached later, without duplicates', async () => {
    const host = new SessionHost({ batchMs: 1000 });
    const session = host.spawn(sh('printf first; sleep 30'));
    const early = recorder();
    host.attach(session.id, early.sink);
    await until(() => host.scrollback(session.id).includes('first'), 'output');

    // Output is still waiting in the batch; attaching flushes it to the early view first.
    const late = recorder();
    host.attach(session.id, late.sink);
    expect(late.messages).toEqual([{ type: 'replay', data: 'first' }]);
    expect(early.output()).toBe('first');
    await host.stop(session.id);
  });

  it('writes input to the process', async () => {
    const host = new SessionHost();
    const session = host.spawn(sh('read line; printf "got:%s" "$line"'));
    const view = recorder();
    const attachment = host.attach(session.id, view.sink);
    attachment.input('xyz\r');
    await until(() => view.output().includes('got:xyz'), 'echoed input');
  });

  it('resizes the terminal', async () => {
    const host = new SessionHost();
    const session = host.spawn(sh('sleep 0.3; stty size'));
    host.resize(session.id, 101, 31);
    const view = recorder();
    host.attach(session.id, view.sink);
    await until(() => view.output().includes('31 101'), 'new size');
  });

  it('stops with SIGTERM', async () => {
    const host = new SessionHost();
    const session = host.spawn(sh('sleep 30', { kind: 'claude' }));
    await host.stop(session.id);
    expect(host.get(session.id)).toMatchObject({ status: 'exited', signal: 15 });
  });

  it('escalates to SIGKILL when the process group ignores SIGTERM', async () => {
    const host = new SessionHost({ killTimeoutMs: 300 });
    const session = host.spawn(sh('trap "" TERM; sleep 30', { kind: 'claude' }));
    await new Promise((r) => setTimeout(r, 100));
    const started = Date.now();
    await host.stop(session.id);
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(host.get(session.id)).toMatchObject({ status: 'exited', signal: 9 });
  });

  it('hangs up shells before SIGTERM', async () => {
    const host = new SessionHost();
    const session = host.spawn(sh('trap "" TERM; sleep 30'));
    await new Promise((r) => setTimeout(r, 100));
    await host.stop(session.id);
    expect(host.get(session.id)).toMatchObject({ status: 'exited', signal: 1 });
  });

  it('removes a session, closing its views and notifying listeners', async () => {
    const host = new SessionHost();
    let changes = 0;
    host.onChange(() => changes++);
    const session = host.spawn(sh('sleep 30'));
    const view = recorder();
    host.attach(session.id, view.sink);
    expect(host.runningCount()).toBe(1);
    await host.remove(session.id);
    expect(view.closed).toBe(true);
    expect(host.list()).toEqual([]);
    expect(changes).toBeGreaterThanOrEqual(3); // spawn, exit, remove
    expect(() => host.get(session.id)).toThrow(/No terminal session/);
  });

  it('stops every running session', async () => {
    const host = new SessionHost();
    host.spawn(sh('sleep 30'));
    host.spawn(sh('sleep 30'));
    await host.stopAll();
    expect(host.runningCount()).toBe(0);
  });

  it('tells a shell at its prompt from one running a program, and refuses to type into a busy one', async () => {
    const host = new SessionHost();
    const view = recorder();
    const info = host.spawn({ ...sh(''), command: '/bin/bash', args: ['--norc'], kind: 'home' });
    host.attach(info.id, view.sink);
    // The foreground name settles after the shell starts (slowly under emulation):
    // wait until five checks in a row agree.
    let idleChecks = 0;
    await until(() => {
      idleChecks = host.isShellIdle(info.id) && host.busyCount() === 0 ? idleChecks + 1 : 0;
      return idleChecks >= 5;
    }, 'the shell at its prompt');
    host.typeIntoShell(info.id, 'sleep 30', 'busy');
    await until(
      () => !host.isShellIdle(info.id) && host.busyCount() === 1,
      'sleep in the foreground',
    );
    expect(() => host.typeIntoShell(info.id, 'echo hi', 'The home terminal is busy')).toThrow(
      'The home terminal is busy',
    );
    await host.remove(info.id);
  }, 20_000);
});
