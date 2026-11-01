/**
 * Writes THIRD_PARTY_NOTICES (spec §15.4): the licenses of everything the
 * packaged app ships. The npm packages are the production dependency tree
 * from package-lock.json (dependencies and optional dependencies, not peers,
 * not type-only @types packages), each with the license files from its
 * folder in node_modules; packages with the same text share one entry. Then
 * the bundled fonts' OFL texts, Bun's LICENSE.md (the helper is compiled with
 * Bun, so its runtime is inside), and a note on what else is inside the app.
 *
 * Bun's LICENSE.md isn't in its npm package: it is kept in scripts/notices/
 * as `bun-v<version>-LICENSE.md`, copied from the version's tag
 * (https://raw.githubusercontent.com/oven-sh/bun/bun-v<version>/LICENSE.md),
 * and a Bun upgrade fails here until the new version's file is added.
 *
 *   tsx scripts/gen-notices.ts            write the file
 *   tsx scripts/gen-notices.ts --check    fail if it is out of date
 */
import fs from 'node:fs';
import path from 'node:path';

interface LockPackage {
  version?: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
}

const root = path.resolve(__dirname, '..');
const OUT = path.join(root, 'THIRD_PARTY_NOTICES');
const FONTS = path.join(root, 'src', 'renderer', 'src', 'styles', 'fonts');

const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockPackage>;
};
const packages = lock.packages;

/** Node's resolution in the lockfile: the nearest node_modules up from `from`. */
function resolve(from: string, name: string): string | null {
  let dir = from;
  for (;;) {
    const key = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (packages[key]) return key;
    if (!dir) return null;
    const at = dir.lastIndexOf('/node_modules/');
    dir = at === -1 ? '' : dir.slice(0, at);
  }
}

/** The production tree from the root package, by lockfile key. */
const seen = new Set<string>();
const queue = [''];
while (queue.length > 0) {
  const key = queue.shift() as string;
  const pkg = packages[key];
  if (!pkg) continue;
  const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
  for (const name of [...Object.keys(pkg.dependencies ?? {}), ...optional]) {
    if (name.startsWith('@types/')) continue;
    const dep = resolve(key, name);
    if (!dep) {
      if (optional.has(name)) continue;
      throw new Error(`${name} (needed by ${key || 'the app'}) is not in package-lock.json`);
    }
    // Platform-specific optional packages differ per machine; none ship today.
    if (packages[dep]?.os || packages[dep]?.cpu) continue;
    if (!seen.has(dep)) {
      seen.add(dep);
      queue.push(dep);
    }
  }
}

const nameOf = (key: string) =>
  key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
/** License files, and notices a package passes on for code it bundles (Monaco). */
const LICENSE_FILE = /^(licen[cs]e|copying|thirdpartynotices)([.-].*)?$/i;

/** License text → the packages that ship it. */
const groups = new Map<string, string[]>();
const listing: string[] = [];
for (const key of [...seen].sort(
  (a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b),
)) {
  const pkg = packages[key] as LockPackage;
  const label = `${nameOf(key)} ${pkg.version}`;
  listing.push(`- ${label}: ${(pkg.license ?? 'see its license').replace(/^\((.*)\)$/, '$1')}`);
  const dir = path.join(root, key);
  const files = fs
    .readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f))
    .sort();
  if (files.length === 0) throw new Error(`${label} has no license file in ${key}`);
  const text = files
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .join('\n\n');
  groups.set(text, [...(groups.get(text) ?? []), label]);
}

const RULE = '-'.repeat(78);
/** The bundled fonts by the name in their OFL file (OFL-<name>.txt next to the fonts). */
const FONT_NAMES: Record<string, string> = {
  IBMPlexSans: 'IBM Plex Sans',
  JetBrainsMono: 'JetBrains Mono',
};
const fonts = fs
  .readdirSync(FONTS)
  .filter((f) => /^OFL-.*\.txt$/.test(f))
  .sort()
  .map((file) => {
    const name = FONT_NAMES[file.slice('OFL-'.length, -'.txt'.length)];
    if (!name) throw new Error(`${file}: add the font's name to FONT_NAMES`);
    return { file, name };
  });

const bunVersion = packages['node_modules/bun']?.version;
if (!bunVersion) throw new Error('bun is not in package-lock.json');
const bunLicense = path.join(root, 'scripts', 'notices', `bun-v${bunVersion}-LICENSE.md`);
if (!fs.existsSync(bunLicense)) {
  throw new Error(
    `${path.relative(root, bunLicense)} is missing: copy it from https://raw.githubusercontent.com/oven-sh/bun/bun-v${bunVersion}/LICENSE.md`,
  );
}

const notices = [
  'THIRD-PARTY NOTICES',
  '',
  'This application includes the third-party software listed below, under the',
  'licenses that follow. Generated by scripts/gen-notices.ts from',
  'package-lock.json; do not edit by hand.',
  '',
  'npm packages:',
  ...listing,
  '',
  'Fonts (SIL Open Font License 1.1):',
  ...fonts.map((f) => `- ${f.name}`),
  '',
  'Also inside the application:',
  '- Electron and Chromium, whose licenses ship next to this file',
  '  (LICENSE.electron.txt, LICENSES.chromium.html).',
  `- The Bun ${bunVersion} runtime, compiled into the helper executable: its`,
  '  LICENSE.md follows, with JavaScriptCore and WebKit (LGPL-2) and the',
  '  libraries it links.',
  '- SQLite, compiled into better-sqlite3: public domain.',
  '',
  ...[...groups].flatMap(([text, labels]) => [RULE, labels.join(', '), RULE, '', text, '']),
  RULE,
  `Bun ${bunVersion} (https://github.com/oven-sh/bun/blob/bun-v${bunVersion}/LICENSE.md)`,
  RULE,
  '',
  fs.readFileSync(bunLicense, 'utf8').replace(/\r\n/g, '\n').trim(),
  '',
  ...fonts.flatMap((f) => [
    RULE,
    f.name,
    RULE,
    '',
    fs.readFileSync(path.join(FONTS, f.file), 'utf8').replace(/\r\n/g, '\n').trim(),
    '',
  ]),
].join('\n');

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== notices) {
    console.error('THIRD_PARTY_NOTICES is out of date: run npm run gen:notices');
    process.exit(1);
  }
  console.log(`check-notices: ${seen.size} packages, ${fonts.length} fonts`);
} else {
  fs.writeFileSync(OUT, notices);
  console.log(`THIRD_PARTY_NOTICES: ${seen.size} packages, ${fonts.length} fonts`);
}
