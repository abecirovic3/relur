import { BRAND } from './brand';

/**
 * New versions (spec §15.7): the GitHub API's latest release of the app's
 * repository, asked once a day when the user agreed to it. Nothing about the
 * user or their work is sent.
 */
export const LATEST_RELEASE_URL = `https://api.github.com/repos/${BRAND.github.owner}/${BRAND.github.repo}/releases/latest`;

/** How often a running app asks again. */
export const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The README's install command, which also updates (spec §15.4). */
export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${BRAND.github.owner}/${BRAND.github.repo}/main/install.sh | sh`;

/** The question on the first start (spec §15.7). */
export const UPDATE_QUESTION = `Check for new versions of ${BRAND.displayName}? ${BRAND.displayName} asks GitHub about its latest release once a day. Nothing about you or your work is sent.`;

/** A release that can be offered. */
export interface Release {
  /** `0.2.0`, without the tag's `v`. */
  version: string;
  /** The release page, for Release notes. */
  url: string;
  /** Download links of its assets, by file name. */
  assets: Record<string, string>;
}

/** `1.2.3` (an optional `v` before it) as numbers; null for anything else, a pre-release included. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when `a` is older than `b`, 0 when equal, positive when newer; null if either isn't a version. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] as number) - (y[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}

const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The release in the API's answer, or null: drafts and pre-releases (flagged
 * so, or with a version like `1.0.0-beta.1`) are never offered.
 */
export function releaseOf(json: unknown): Release | null {
  const r = record(json);
  if (!r || r.draft === true || r.prerelease === true) return null;
  const tag = typeof r.tag_name === 'string' ? r.tag_name : '';
  const parsed = parseVersion(tag);
  if (!parsed) return null;
  const assets: Record<string, string> = {};
  for (const a of Array.isArray(r.assets) ? r.assets : []) {
    const asset = record(a);
    if (typeof asset?.name === 'string' && typeof asset.browser_download_url === 'string') {
      assets[asset.name] = asset.browser_download_url;
    }
  }
  return {
    version: parsed.join('.'),
    url:
      typeof r.html_url === 'string' && /^https:\/\//.test(r.html_url)
        ? r.html_url
        : `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}/releases/tag/${tag}`,
    assets,
  };
}

/**
 * Whether to offer the release (spec §15.7): newer than this version, and not
 * the version the user skipped, unless they asked themselves.
 */
export function shouldOffer(
  release: Release | null,
  current: string,
  { skipped = null, manual = false }: { skipped?: string | null; manual?: boolean } = {},
): boolean {
  if (!release) return false;
  const newer = compareVersions(release.version, current);
  if (newer === null || newer <= 0) return false;
  return manual || release.version !== skipped;
}

/** The .deb of a release for this architecture, and the apt command that installs it (spec §15.7). */
export function debUpdate(release: Release, arch: string): { url: string; command: string } {
  const file = `${BRAND.displayName}-linux-${arch === 'arm64' ? 'arm64' : 'x64'}.deb`;
  const url =
    release.assets[file] ??
    `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}/releases/download/v${release.version}/${file}`;
  return {
    url,
    command: `cd /tmp && curl -fLO ${url} && sudo apt install ./${file}`,
  };
}
