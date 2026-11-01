/**
 * Compiles the helper (src/helper) into one executable with bun, at
 * out/helper/<helper command>. With `--arch arm64|x64` it cross-compiles one
 * for packaging instead, for macOS or with `--platform linux` for Linux, at
 * out/helper-<platform>-<arch>/<helper command> (bun fetches that runtime the
 * first time). Linux x64 uses bun's baseline build, which runs on CPUs
 * without AVX2. bun is a pinned
 * dev dependency; its platform package holds the binary until bun's own
 * install script moves it into node_modules/bun/bin, so both places are tried.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/shared/brand';

const root = path.join(import.meta.dirname, '..');
const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
const platformBun = path.join(
  root,
  'node_modules',
  '@oven',
  `bun-${process.platform}-${arch}`,
  'bin',
  'bun',
);
const bun = fs.existsSync(platformBun)
  ? platformBun
  : path.join(root, 'node_modules', '.bin', 'bun');
const at = process.argv.indexOf('--arch');
const target = at === -1 ? null : process.argv[at + 1];
if (target !== null && target !== 'arm64' && target !== 'x64') {
  throw new Error(`--arch must be arm64 or x64, not ${target}`);
}
const platformAt = process.argv.indexOf('--platform');
const platform = platformAt === -1 ? 'darwin' : process.argv[platformAt + 1];
if (platform !== 'darwin' && platform !== 'linux') {
  throw new Error(`--platform must be darwin or linux, not ${platform}`);
}
const out = target
  ? path.join(root, 'out', `helper-${platform}-${target}`, BRAND.helperCommand)
  : path.join(root, 'out', 'helper', BRAND.helperCommand);
/** bun's name for the target. */
const bunTarget =
  target === 'arm64'
    ? `bun-${platform}-aarch64`
    : platform === 'linux'
      ? 'bun-linux-x64-baseline'
      : 'bun-darwin-x64';

fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(
  bun,
  [
    'build',
    path.join(root, 'src', 'helper', 'main.ts'),
    // For the @shared/* path alias.
    '--tsconfig-override',
    path.join(root, 'tsconfig.node.json'),
    '--compile',
    ...(target ? [`--target=${bunTarget}`] : []),
    '--minify',
    '--outfile',
    out,
  ],
  { stdio: ['ignore', 'ignore', 'inherit'] },
);
console.log(`helper: ${path.relative(root, out)}`);
