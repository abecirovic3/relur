import { BRAND } from '@shared/brand';
import { describe, expect, it } from 'vitest';
import { scrubInherited } from './scrub';

describe('scrubInherited', () => {
  it("drops the app's and the old app's variables, and keeps the user's", () => {
    const env = scrubInherited({
      [`${BRAND.envPrefix}WORKSPACE_ID`]: 'w1',
      [`${BRAND.legacy.envPrefix}WORKSPACE_ID`]: 'w0',
      [`${BRAND.legacy.envPrefix}BRIDGE_TOKEN`]: 't',
      CLAUDECODE: '1',
      CLAUDE_CONFIG_DIR: '/c',
      PATH: '/usr/bin',
      HOME: '/home/u',
    });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/home/u' });
  });

  it('drops what the AppImage runtime and the desktop launch set (Linux)', () => {
    const env = scrubInherited({
      APPIMAGE: '/home/u/Applications/App.AppImage',
      APPDIR: '/tmp/.mount_App',
      ARGV0: 'App',
      OWD: '/home/u',
      CHROME_DESKTOP: 'app.desktop',
      DESKTOP_STARTUP_ID: 'x',
      XDG_ACTIVATION_TOKEN: 'y',
      LD_LIBRARY_PATH: '/opt/lib',
      PATH: '/usr/bin',
    });
    expect(env).toEqual({ LD_LIBRARY_PATH: '/opt/lib', PATH: '/usr/bin' });
  });
});
