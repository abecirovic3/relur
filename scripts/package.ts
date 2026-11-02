/**
 * Packages the app (spec §15.4, §15.6): for macOS a .zip and a .dmg per
 * architecture, for Linux an AppImage and a .deb, in dist/, named and
 * identified from BRAND, plus SHA256SUMS for the release (install.sh checks
 * it). `npm run package` builds first.
 *
 *   tsx scripts/package.ts [--platform mac|linux] [--arch arm64|x64|all]
 *
 * The platform and architecture default to this machine's.
 * - macOS, Apple Silicon (arm64) and Intel (x64): node-pty and better-sqlite3
 *   ship prebuilt binaries for both, and bun cross-compiles the helper.
 *   Signing: ad hoc only (no Apple Developer ID), no notarization, no
 *   auto-update.
 * - Linux: node-pty has no prebuilt Linux binaries, so `npm ci` compiles it
 *   for the machine it runs on, and Linux packages are built on Linux, for
 *   that machine's architecture only (scripts/linux-package.sh builds them in
 *   Docker on Debian 11, so they run with glibc 2.31 and later). The
 *   executable and desktop entry are BRAND.linuxExecutable, leaving the CLI's
 *   name free; desktopName makes it the Wayland app id and WM_CLASS too. The
 *   .deb sets up chrome-sandbox and an AppArmor profile (electron-builder's
 *   own install script), so the sandbox works on Ubuntu 24.04.
 * - The helper goes into the resources folder (Contents/Resources/helper on
 *   macOS, resources/helper on Linux), outside the asar, so hooks, the status
 *   line and the command line tool can run it.
 * - LICENSE and THIRD_PARTY_NOTICES go into the resources folder too.
 * - node-pty (with its spawn-helper) and better-sqlite3 are unpacked from the
 *   asar so their native code loads; only the target's binaries.
 * - Electron fuses turn off RUN_AS_NODE, NODE_OPTIONS and the --inspect
 *   arguments in the packaged app only; `npm run dev`, `npm start` and the
 *   scripted tests run Electron from node_modules and keep the inspector.
 */
import './lib/clean-env';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type CliOptions, type Configuration } from 'electron-builder';
import { type Arch, BRAND, CHECKSUMS_FILE, releaseAsset } from '../src/shared/brand';

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  devDependencies: Record<string, string>;
};

const option = (name: string) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : process.argv[at + 1];
};
const platform = option('--platform') ?? (process.platform === 'linux' ? 'linux' : 'mac');
if (platform !== 'mac' && platform !== 'linux') {
  throw new Error(`--platform must be mac or linux, not ${platform}`);
}
if (platform === 'linux' && process.platform !== 'linux') {
  throw new Error('Linux packages are built on Linux: run scripts/linux-package.sh');
}
const here: Arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const asked = option('--arch') ?? here;
const arches: Arch[] =
  asked === 'all' ? ['arm64', 'x64'] : asked === 'arm64' || asked === 'x64' ? [asked] : [];
if (arches.length === 0) throw new Error(`--arch must be arm64, x64 or all, not ${asked}`);
if (platform === 'linux' && arches.some((arch) => arch !== here)) {
  // node-pty is compiled by npm ci for this machine only.
  throw new Error(`Linux packages are built for this machine's architecture, ${here}`);
}
if (!fs.existsSync(path.join(root, 'out', 'main', 'index.js'))) {
  throw new Error('out/ is missing: run npm run build first');
}
if (platform === 'mac' && !fs.existsSync(path.join(root, 'build', 'icon.icns'))) {
  execFileSync('bash', [path.join(root, 'scripts', 'make-icon.sh')], { stdio: 'inherit' });
}

/** Bundled into out/renderer by Vite: not needed at runtime. */
const RENDERER_ONLY = [
  'monaco-editor',
  'dompurify',
  'marked',
  'react',
  'react-dom',
  'scheduler',
  '@xterm',
  '@tanstack',
  '@trpc/client',
  '@trpc/tanstack-react-query',
];

/** releaseAsset(arch, ext) as an electron-builder name template. */
const artifactName = (arch: Arch, ext: 'zip' | 'AppImage') =>
  releaseAsset(arch, ext).replace(new RegExp(`${ext}$`), '$' + '{ext}');

/**
 * The .deb's after-install script: electron-builder's own, then
 * build/linux/after-install-sandbox.sh, which makes chrome-sandbox setuid
 * where a user can't use the namespace sandbox (spec §15.6).
 */
function debAfterInstall(): string {
  const templates = path.join(
    path.dirname(require.resolve('app-builder-lib/package.json')),
    'templates',
    'linux',
  );
  const script = [
    fs.readFileSync(path.join(templates, 'after-install.tpl'), 'utf8'),
    fs.readFileSync(path.join(root, 'build', 'linux', 'after-install-sandbox.sh'), 'utf8'),
  ].join('\n');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'deb-')), 'after-install.tpl');
  fs.writeFileSync(file, script);
  return file;
}

function config(arch: Arch): Configuration {
  const other = arch === 'arm64' ? 'x64' : 'arm64';
  const nativeFiles =
    platform === 'mac'
      ? [
          // Native modules: this architecture's macOS binaries only, no sources.
          '!node_modules/node-pty/{deps,src,scripts,third_party,binding.gyp}{,/**}',
          `!node_modules/node-pty/prebuilds/{darwin-${other},win32-arm64,win32-x64}{,/**}`,
          '!node_modules/better-sqlite3/{deps,src,binding.gyp}{,/**}',
          `!node_modules/better-sqlite3/prebuilds/!(darwin-${arch}.node)`,
        ]
      : [
          // node-pty as npm ci compiled it (build/Release/pty.node), without
          // its sources, build files or the other platforms' prebuilt binaries.
          '!node_modules/node-pty/{deps,src,scripts,third_party,binding.gyp,prebuilds}{,/**}',
          '!node_modules/node-pty/build/{config.gypi,Makefile,*.mk,deps}{,/**}',
          '!node_modules/node-pty/build/Release/{obj.target,.deps,obj}{,/**}',
          '!node_modules/better-sqlite3/{deps,src,binding.gyp}{,/**}',
          `!node_modules/better-sqlite3/prebuilds/!(linux-${arch}.node)`,
        ];
  return {
    appId: BRAND.bundleId,
    productName: BRAND.displayName,
    executableName: platform === 'mac' ? BRAND.displayName : BRAND.linuxExecutable,
    // macOS shows it as NSHumanReadableCopyright; as in LICENSE.
    copyright: '© 2026 Dino Zecevic',
    electronVersion: pkg.devDependencies.electron,
    directories: { output: 'dist', buildResources: 'build' },
    // Linux: the package's name (apt), and the desktop entry Electron names
    // as its Wayland app id and WM_CLASS (spec §15.6).
    extraMetadata:
      platform === 'linux'
        ? {
            name: BRAND.slug,
            desktopName: `${BRAND.linuxExecutable}.desktop`,
            homepage: `https://github.com/${BRAND.github.owner}/${BRAND.github.repo}`,
          }
        : {},
    files: [
      'out/main/**',
      'out/preload/**',
      'out/renderer/**',
      'package.json',
      ...RENDERER_ONLY.map((name) => `!node_modules/${name}/**`),
      ...nativeFiles,
    ],
    extraResources: [
      {
        from: `out/helper-${platform === 'mac' ? 'darwin' : 'linux'}-${arch}`,
        to: 'helper',
        filter: [BRAND.helperCommand],
      },
      // The license and the third-party notices (scripts/gen-notices.ts), next
      // to Electron's own license files.
      { from: 'LICENSE', to: 'LICENSE' },
      { from: 'THIRD_PARTY_NOTICES', to: 'THIRD_PARTY_NOTICES' },
      // Linux: the window's and notifications' icon (src/main/window.ts).
      ...(platform === 'linux' ? [{ from: 'build/icons/256x256.png', to: 'icon.png' }] : []),
    ],
    asar: true,
    asarUnpack: ['node_modules/node-pty/**', 'node_modules/better-sqlite3/**'],
    // Both are N-API binaries that load in Electron as they are.
    npmRebuild: false,
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
    },
    mac: {
      category: 'public.app-category.developer-tools',
      icon: 'build/icon.icns',
      // "-" signs ad hoc; there is no Developer ID to sign or notarize with.
      identity: '-',
      hardenedRuntime: false,
      notarize: false,
      artifactName: artifactName(arch, 'zip'),
      extendInfo: {
        // Shown when macOS asks to allow notifications.
        NSUserNotificationsUsageDescription: `${BRAND.displayName} tells you when Claude needs you or has finished.`,
      },
    },
    dmg: { title: `${BRAND.displayName} ${pkg.version}`, artifactName: artifactName(arch, 'zip') },
    linux: {
      // build/icons/<n>x<n>.png (scripts/make-icon.sh).
      icon: 'build/icons',
      category: 'Development',
      synopsis: 'Parallel Claude Code sessions in git worktrees',
      // The .deb's maintainer is package.json's author.
      vendor: BRAND.github.owner,
      syncDesktopName: true,
      artifactName: artifactName(arch, 'AppImage'),
    },
    appImage: { artifactName: artifactName(arch, 'AppImage') },
    deb: {
      artifactName: artifactName(arch, 'AppImage'),
      afterInstall: platform === 'linux' ? debAfterInstall() : undefined,
      // electron-builder's own list, plus git, which worktrees need.
      depends: [
        'libgtk-3-0',
        'libnotify4',
        'libnss3',
        'libxss1',
        'libxtst6',
        'xdg-utils',
        'libatspi2.0-0',
        'libuuid1',
        'libsecret-1-0',
        'git',
      ],
    },
    // AppImage's static runtime: it needs only fusermount (fuse3 or fuse) to
    // start, not FUSE 2's library, which newer distributions don't install.
    toolsets: { appimage: '1.0.3' },
    publish: null,
  };
}

async function main() {
  for (const arch of arches) {
    execFileSync(
      'npx',
      [
        'tsx',
        '--tsconfig',
        'tsconfig.node.json',
        'scripts/build-helper.ts',
        '--platform',
        platform === 'mac' ? 'darwin' : 'linux',
        '--arch',
        arch,
      ],
      { cwd: root, stdio: 'inherit' },
    );
    const target: CliOptions = { config: config(arch), publish: 'never' };
    if (platform === 'mac') target.mac = ['zip', 'dmg'];
    else target.linux = ['AppImage', 'deb'];
    target[arch] = true;
    await build(target);
  }
  // Checksums of every release asset in dist/, as `shasum -a 256` prints them.
  const assets = (['arm64', 'x64'] as const)
    .flatMap((arch) =>
      (['zip', 'dmg', 'AppImage', 'deb'] as const).map((ext) => releaseAsset(arch, ext)),
    )
    .filter((name) => fs.existsSync(path.join(dist, name)));
  const sums = assets.map((name) => {
    const hash = createHash('sha256')
      .update(fs.readFileSync(path.join(dist, name)))
      .digest('hex');
    return `${hash}  ${name}\n`;
  });
  fs.writeFileSync(path.join(dist, CHECKSUMS_FILE), sums.join(''));
  for (const name of [...assets, CHECKSUMS_FILE]) console.log(`dist/${name}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
