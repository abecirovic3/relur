import { BRAND } from '@shared/brand';

/**
 * Report a Bug… and Request a Feature… (spec §6.12): the repository's issue
 * forms in the browser. Nothing is sent; the bug report form is prefilled
 * through its field ids (`.github/ISSUE_TEMPLATE/bug_report.yml`) and the
 * user reviews it before submitting.
 */
const NEW_ISSUE = `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}/issues/new`;

export const BUG_TEMPLATE = 'bug_report.yml';
export const FEATURE_TEMPLATE = 'feature_request.yml';

/** What the bug report form is prefilled with; an empty value is left out. */
export interface BugReportInfo {
  appVersion: string;
  /** One of the form's Operating system options (`osOption`). */
  os: string;
  osVersion: string;
  /** From the setup check; empty when unknown. */
  claudeVersion: string;
}

export function bugReportUrl(info: BugReportInfo): string {
  const fields: [string, string][] = [
    ['template', BUG_TEMPLATE],
    ['app-version', info.appVersion],
    ['os', info.os],
    ['os-version', info.osVersion],
    ['claude-version', info.claudeVersion],
  ];
  const query = fields
    .filter(([, value]) => value !== '')
    .map(([id, value]) => `${id}=${encodeURIComponent(value)}`)
    .join('&');
  return `${NEW_ISSUE}?${query}`;
}

export const featureRequestUrl = (): string => `${NEW_ISSUE}?template=${FEATURE_TEMPLATE}`;

/**
 * The form's Operating system option for this installation: a build that
 * isn't packaged is Built from source, and on Linux an AppImage sets `APPIMAGE`.
 */
export function osOption(options: {
  platform: NodeJS.Platform;
  arch: string;
  packaged: boolean;
  appImage: boolean;
}): string {
  if (!options.packaged) return 'Built from source';
  if (options.platform === 'darwin') {
    return options.arch === 'arm64' ? 'macOS (Apple Silicon)' : 'macOS (Intel)';
  }
  if (options.platform === 'linux') {
    return `Linux ${options.arch} (${options.appImage ? 'AppImage' : '.deb'})`;
  }
  return '';
}

/** The `PRETTY_NAME` of an os-release file, or null. */
export function prettyName(osRelease: string): string | null {
  const match = /^PRETTY_NAME=(["']?)(.*)\1\s*$/m.exec(osRelease);
  return match?.[2] || null;
}

/**
 * The OS version as the form asks for it: "macOS 15.4", or on Linux the
 * distribution with the desktop and session type ("Ubuntu 24.04 LTS with
 * GNOME on Wayland"), as far as they are known.
 */
export function osVersion(options: {
  platform: NodeJS.Platform;
  /** Electron's `process.getSystemVersion()`. */
  systemVersion: string;
  /** /etc/os-release, or null when it can't be read. */
  osRelease: string | null;
  env: Record<string, string | undefined>;
}): string {
  if (options.platform === 'darwin') return `macOS ${options.systemVersion}`.trim();
  if (options.platform !== 'linux') return options.systemVersion;
  let text =
    (options.osRelease && prettyName(options.osRelease)) || `Linux ${options.systemVersion}`;
  const desktop = options.env.XDG_CURRENT_DESKTOP?.split(':').at(-1);
  if (desktop) text += ` with ${desktop}`;
  const session = options.env.XDG_SESSION_TYPE;
  if (session === 'wayland' || session === 'x11') {
    text += ` on ${session === 'wayland' ? 'Wayland' : 'X11'}`;
  }
  return text.trim();
}
