import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '@shared/brand';
import { describe, expect, it } from 'vitest';
import {
  BUG_TEMPLATE,
  bugReportUrl,
  FEATURE_TEMPLATE,
  featureRequestUrl,
  osOption,
  osVersion,
  prettyName,
} from './feedback';

const NEW_ISSUE = `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}/issues/new`;
const templates = path.join(__dirname, '..', '..', '.github', 'ISSUE_TEMPLATE');
const form = (name: string) => fs.readFileSync(path.join(templates, name), 'utf8');

describe('bugReportUrl', () => {
  it('prefills the form through its field ids, each value encoded', () => {
    const url = bugReportUrl({
      appVersion: '0.3.0',
      os: 'macOS (Apple Silicon)',
      osVersion: 'macOS 15.4',
      claudeVersion: '2.1.312',
    });
    expect(url).toBe(
      `${NEW_ISSUE}?template=bug_report.yml&app-version=0.3.0&os=macOS%20(Apple%20Silicon)&os-version=macOS%2015.4&claude-version=2.1.312`,
    );
    const params = new URL(url).searchParams;
    expect(params.get('os')).toBe('macOS (Apple Silicon)');
  });

  it('encodes characters that would break the query', () => {
    const url = bugReportUrl({
      appVersion: '1.0.0-beta+1',
      os: 'Linux x64 (.deb)',
      osVersion: 'Debian GNU/Linux 12 & more #1 = ü',
      claudeVersion: '',
    });
    expect(url).toContain('app-version=1.0.0-beta%2B1');
    expect(url).toContain(
      'os-version=Debian%20GNU%2FLinux%2012%20%26%20more%20%231%20%3D%20%C3%BC',
    );
    const params = new URL(url).searchParams;
    expect(params.get('app-version')).toBe('1.0.0-beta+1');
    expect(params.get('os-version')).toBe('Debian GNU/Linux 12 & more #1 = ü');
  });

  it('leaves out what is unknown, such as the Claude Code version', () => {
    const url = bugReportUrl({ appVersion: '0.3.0', os: '', osVersion: 'x', claudeVersion: '' });
    expect([...new URL(url).searchParams.keys()]).toEqual([
      'template',
      'app-version',
      'os-version',
    ]);
  });

  it("uses only the form's own field ids and options", () => {
    const bug = form(BUG_TEMPLATE);
    const ids = [...bug.matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1]);
    const url = bugReportUrl({ appVersion: 'a', os: 'b', osVersion: 'c', claudeVersion: 'd' });
    for (const key of new URL(url).searchParams.keys()) {
      if (key !== 'template') expect(ids, key).toContain(key);
    }
    // Every option osOption can give is one of the dropdown's.
    const options = [...bug.matchAll(/^\s+- (.+)$/gm)].map((m) => m[1]);
    for (const platform of ['darwin', 'linux'] as const) {
      for (const arch of ['arm64', 'x64']) {
        for (const appImage of [true, false]) {
          for (const packaged of [true, false]) {
            expect(options).toContain(osOption({ platform, arch, packaged, appImage }));
          }
        }
      }
    }
  });
});

describe('featureRequestUrl', () => {
  it('opens the feature request form, unprefilled', () => {
    expect(featureRequestUrl()).toBe(`${NEW_ISSUE}?template=feature_request.yml`);
    expect(form(FEATURE_TEMPLATE)).toMatch(/^name: Feature request$/m);
  });
});

describe('osOption', () => {
  it('names the installation as the form does', () => {
    const mac = { platform: 'darwin' as const, packaged: true, appImage: false };
    expect(osOption({ ...mac, arch: 'arm64' })).toBe('macOS (Apple Silicon)');
    expect(osOption({ ...mac, arch: 'x64' })).toBe('macOS (Intel)');
    const linux = { platform: 'linux' as const, packaged: true };
    expect(osOption({ ...linux, arch: 'x64', appImage: true })).toBe('Linux x64 (AppImage)');
    expect(osOption({ ...linux, arch: 'arm64', appImage: false })).toBe('Linux arm64 (.deb)');
    expect(osOption({ ...mac, arch: 'arm64', packaged: false })).toBe('Built from source');
  });
});

describe('osVersion', () => {
  it('gives the macOS version', () => {
    expect(
      osVersion({ platform: 'darwin', systemVersion: '15.4.1', osRelease: null, env: {} }),
    ).toBe('macOS 15.4.1');
  });

  it('gives the Linux distribution with its desktop and session type', () => {
    const osRelease = 'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu\n';
    expect(
      osVersion({
        platform: 'linux',
        systemVersion: '6.8.0',
        osRelease,
        env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME', XDG_SESSION_TYPE: 'wayland' },
      }),
    ).toBe('Ubuntu 24.04.1 LTS with GNOME on Wayland');
    expect(osVersion({ platform: 'linux', systemVersion: '6.8.0', osRelease: null, env: {} })).toBe(
      'Linux 6.8.0',
    );
  });

  it('reads PRETTY_NAME quoted or not', () => {
    expect(prettyName("PRETTY_NAME='Fedora Linux 41'")).toBe('Fedora Linux 41');
    expect(prettyName('PRETTY_NAME=Arch\nID=arch')).toBe('Arch');
    expect(prettyName('NAME=x')).toBeNull();
  });
});
