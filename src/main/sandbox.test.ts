import { describe, expect, it } from 'vitest';
import { sandboxOff } from './sandbox';

describe('sandboxOff', () => {
  const namespaces =
    (table: Record<string, string>) =>
    (pid: number | 'self', ns: string): string => {
      const value = table[`${pid}/${ns}`];
      if (value === undefined) throw new Error('EACCES');
      return value;
    };

  it('says so when started with --no-sandbox, on every platform', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(sandboxOff({ noSandboxSwitch: true, platform, renderers: [] })).toBe(
        'started with --no-sandbox',
      );
    }
  });

  it('is on outside Linux without the switch', () => {
    expect(sandboxOff({ noSandboxSwitch: false, platform: 'darwin', renderers: [7] })).toBeNull();
  });

  it('is on when every renderer has a PID namespace of its own, or one that can’t be read', () => {
    const readNamespace = namespaces({ 'self/pid': 'pid:[1]', '7/pid': 'pid:[2]' });
    expect(
      sandboxOff({ noSandboxSwitch: false, platform: 'linux', renderers: [7, 8], readNamespace }),
    ).toBeNull();
  });

  it('is off when a renderer shares the main process’s PID namespace', () => {
    const readNamespace = namespaces({
      'self/pid': 'pid:[1]',
      '7/pid': 'pid:[2]',
      '8/pid': 'pid:[1]',
    });
    expect(
      sandboxOff({ noSandboxSwitch: false, platform: 'linux', renderers: [7, 8], readNamespace }),
    ).toBe("renderer 8 runs in the main process's PID namespace");
  });
});
