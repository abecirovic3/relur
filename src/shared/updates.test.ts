import { describe, expect, it } from 'vitest';
import { BRAND } from './brand';
import { compareVersions, debUpdate, parseVersion, releaseOf, shouldOffer } from './updates';

const api = (fields: Record<string, unknown>) => ({
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/o/r/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    {
      name: `${BRAND.displayName}-linux-x64.deb`,
      browser_download_url: 'https://github.com/o/r/releases/download/v0.2.0/x.deb',
    },
  ],
  ...fields,
});

describe('versions', () => {
  it('compares by number, not by text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
  });

  it('reads only plain versions: a pre-release or other text is none', () => {
    expect(parseVersion('v0.2.0')).toEqual([0, 2, 0]);
    expect(parseVersion('0.2.0-beta.1')).toBeNull();
    expect(parseVersion('nightly')).toBeNull();
    expect(compareVersions('1.0.0-rc.1', '0.9.0')).toBeNull();
  });
});

describe('releaseOf', () => {
  it('reads the version, the page and the assets', () => {
    expect(releaseOf(api({}))).toEqual({
      version: '0.2.0',
      url: 'https://github.com/o/r/releases/tag/v0.2.0',
      assets: {
        [`${BRAND.displayName}-linux-x64.deb`]:
          'https://github.com/o/r/releases/download/v0.2.0/x.deb',
      },
    });
  });

  it('ignores drafts and pre-releases', () => {
    expect(releaseOf(api({ draft: true }))).toBeNull();
    expect(releaseOf(api({ prerelease: true }))).toBeNull();
    expect(releaseOf(api({ tag_name: 'v0.3.0-beta.1' }))).toBeNull();
    expect(releaseOf(null)).toBeNull();
    expect(releaseOf({ message: 'Not Found' })).toBeNull();
  });

  it('never takes a release page that is not https', () => {
    expect(releaseOf(api({ html_url: 'file:///etc/passwd' }))?.url).toMatch(
      /^https:\/\/github\.com\/.+\/releases\/tag\/v0\.2\.0$/,
    );
  });
});

describe('shouldOffer', () => {
  const release = releaseOf(api({}));

  it('offers only a newer version', () => {
    expect(shouldOffer(release, '0.1.0')).toBe(true);
    expect(shouldOffer(release, '0.2.0')).toBe(false);
    expect(shouldOffer(release, '0.3.0')).toBe(false);
    expect(shouldOffer(null, '0.1.0')).toBe(false);
  });

  it('remembers a skipped version, but a manual check shows it', () => {
    expect(shouldOffer(release, '0.1.0', { skipped: '0.2.0' })).toBe(false);
    expect(shouldOffer(release, '0.1.0', { skipped: '0.1.5' })).toBe(true);
    expect(shouldOffer(release, '0.1.0', { skipped: '0.2.0', manual: true })).toBe(true);
  });
});

describe('debUpdate', () => {
  it("uses the release's own .deb link, else the release's download path", () => {
    const release = releaseOf(api({}));
    if (!release) throw new Error('no release');
    expect(debUpdate(release, 'x64')).toEqual({
      url: 'https://github.com/o/r/releases/download/v0.2.0/x.deb',
      command: `cd /tmp && curl -fLO https://github.com/o/r/releases/download/v0.2.0/x.deb && sudo apt install ./${BRAND.displayName}-linux-x64.deb`,
    });
    expect(debUpdate(release, 'arm64').url).toMatch(
      new RegExp(`/releases/download/v0\\.2\\.0/${BRAND.displayName}-linux-arm64\\.deb$`),
    );
  });
});
