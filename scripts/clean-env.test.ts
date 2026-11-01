import { describe, expect, it } from 'vitest';
import { envVar } from '../src/shared/brand';
import { dropInheritedAppEnv } from './lib/clean-env';

describe('dropInheritedAppEnv', () => {
  it("drops only the app's own variables", () => {
    const env = {
      [envVar('CONFIG_DIR')]: '/real',
      [envVar('BRIDGE_URL')]: 'http://x',
      PATH: '/bin',
    };
    expect(dropInheritedAppEnv(env).sort()).toEqual([envVar('BRIDGE_URL'), envVar('CONFIG_DIR')]);
    expect(env).toEqual({ PATH: '/bin' });
  });

  it('has already run for the test process', () => {
    expect(Object.keys(process.env).filter((key) => key.startsWith(envVar('')))).toEqual([]);
  });
});
