import { BRAND } from '@shared/brand';
import { describe, expect, it } from 'vitest';
import { appConfigDir, appHomeDir } from './paths';

describe('appConfigDir', () => {
  it('uses Application Support on macOS', () => {
    expect(appConfigDir({ platform: 'darwin', env: {}, homeDir: '/Users/u' })).toBe(
      `/Users/u/Library/Application Support/${BRAND.displayName}`,
    );
  });

  it('uses ~/.config/<slug> on Linux', () => {
    expect(appConfigDir({ platform: 'linux', env: {}, homeDir: '/home/u' })).toBe(
      `/home/u/.config/${BRAND.slug}`,
    );
  });

  it('honours an absolute XDG_CONFIG_HOME on Linux and ignores a relative one', () => {
    expect(
      appConfigDir({ platform: 'linux', env: { XDG_CONFIG_HOME: '/xdg' }, homeDir: '/home/u' }),
    ).toBe(`/xdg/${BRAND.slug}`);
    expect(
      appConfigDir({ platform: 'linux', env: { XDG_CONFIG_HOME: 'rel' }, homeDir: '/home/u' }),
    ).toBe(`/home/u/.config/${BRAND.slug}`);
  });

  it('uses %APPDATA% on Windows', () => {
    expect(
      appConfigDir({
        platform: 'win32',
        env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
        homeDir: 'C:\\Users\\u',
      }),
    ).toBe(`C:\\Users\\u\\AppData\\Roaming\\${BRAND.displayName}`);
  });
});

describe("the old app's folders", () => {
  it('are named from BRAND.legacy', () => {
    const info = { platform: 'darwin' as const, env: {}, homeDir: '/Users/u' };
    expect(appConfigDir(info, BRAND.legacy)).toBe(
      `/Users/u/Library/Application Support/${BRAND.legacy.displayName}`,
    );
    expect(appHomeDir(info, BRAND.legacy)).toBe(`/Users/u/${BRAND.legacy.homeDirName}`);
  });
});

describe('appHomeDir', () => {
  it('is a dot folder in the home directory', () => {
    expect(appHomeDir({ platform: 'linux', env: {}, homeDir: '/home/u' })).toBe(
      `/home/u/${BRAND.homeDirName}`,
    );
  });
});
