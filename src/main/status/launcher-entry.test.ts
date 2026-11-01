import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { encodeMessage, LauncherBadge, launcherUpdate, sessionBusPath } from './launcher-entry';

const has = (command: string) => {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('sessionBusPath', () => {
  it('reads the unix path or abstract name from the address, else the standard socket', () => {
    const none = () => false;
    expect(sessionBusPath({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/7/bus' }, 7, none)).toBe(
      '/run/user/7/bus',
    );
    expect(
      sessionBusPath(
        { DBUS_SESSION_BUS_ADDRESS: 'tcp:host=x;unix:abstract=/tmp/dbus-Ab%2c,guid=12' },
        7,
        none,
      ),
    ).toBe('\0/tmp/dbus-Ab,');
    expect(sessionBusPath({}, 7, (f) => f === '/run/user/7/bus')).toBe('/run/user/7/bus');
    expect(sessionBusPath({}, 7, none)).toBeNull();
  });
});

describe('encodeMessage', () => {
  it('writes Hello as the D-Bus specification lays it out', () => {
    const hello = encodeMessage({
      type: 'call',
      serial: 1,
      path: '/org/freedesktop/DBus',
      iface: 'org.freedesktop.DBus',
      member: 'Hello',
      destination: 'org.freedesktop.DBus',
    });
    // l, method call, no flags, version 1, empty body, serial 1.
    expect([...hello.subarray(0, 12)]).toEqual([108, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0]);
    // The header fields array is 8-aligned and the header ends 8-aligned.
    expect(hello.length % 8).toBe(0);
    expect(hello.length).toBe(Math.ceil((16 + hello.readUInt32LE(12)) / 8) * 8);
    expect(hello.toString('latin1')).toContain('/org/freedesktop/DBus\0');
  });

  it('puts the count and its visibility in the Update signal', () => {
    const update = launcherUpdate(5, 'application://x.desktop', 3);
    const bodyLength = update.readUInt32LE(4);
    const body = update.subarray(update.length - bodyLength);
    expect(body.readUInt32LE(0)).toBe('application://x.desktop'.length);
    expect(body.toString('latin1')).toContain('count\0');
    expect(body.toString('latin1')).toContain('count-visible\0');
  });
});

// On Linux with dbus installed (the Docker check has it): a real bus sees the signal.
describe.runIf(process.platform === 'linux' && has('dbus-daemon') && has('dbus-monitor'))(
  'LauncherBadge on a session bus',
  () => {
    const children: ChildProcess[] = [];
    afterAll(() => {
      for (const child of children) child.kill();
    });

    it('sends Update with the count, and keeps its connection for the next one', async () => {
      const daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address'], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      children.push(daemon);
      const address = await new Promise<string>((resolve) =>
        daemon.stdout?.once('data', (chunk: Buffer) => resolve(chunk.toString().trim())),
      );
      const monitor = spawn(
        'dbus-monitor',
        ['--address', address, "type='signal',interface='com.canonical.Unity.LauncherEntry'"],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      children.push(monitor);
      let seen = '';
      monitor.stdout?.on('data', (chunk: Buffer) => {
        seen += chunk.toString();
      });
      await new Promise((r) => setTimeout(r, 500));
      const path = sessionBusPath({ DBUS_SESSION_BUS_ADDRESS: address }, 0);
      const badge = new LauncherBadge('application://x.desktop', path, process.getuid?.() ?? 0);
      badge.set(3);
      await new Promise((r) => setTimeout(r, 500));
      badge.set(0);
      await new Promise((r) => setTimeout(r, 500));
      badge.close();
      expect(seen).toContain('member=Update');
      expect(seen).toContain('string "application://x.desktop"');
      expect(seen).toContain('int64 3');
      expect(seen).toContain('boolean true');
      expect(seen).toContain('int64 0');
      expect(seen).toContain('boolean false');
    }, 10_000);
  },
);
