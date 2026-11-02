/**
 * Fails when the product name, or its previous one (BRAND.legacy), appears
 * outside src/shared/brand.ts, so a rename stays a one-file change. Docs and
 * the README, LICENSE and CHANGELOG, and .github's CONTRIBUTING, SECURITY and
 * CODE_OF_CONDUCT are exempt.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/shared/brand';

const EXEMPT: RegExp[] = [
  /^src\/shared\/brand\.ts$/,
  /^docs\//,
  // Generated from scripts/install.template.sh with BRAND (scripts/gen-install.ts).
  /^install\.sh$/,
  /^(README\.md|LICENSE|CHANGELOG\.md)$/,
  /^\.github\/(CONTRIBUTING|SECURITY|CODE_OF_CONDUCT)\.md$/,
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const names = [BRAND.slug, BRAND.displayName, BRAND.legacy.slug, BRAND.legacy.displayName];
const pattern = new RegExp(names.map(escapeRegExp).join('|'), 'i');

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    cwd: root,
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((f) => f && !EXEMPT.some((re) => re.test(f)));

const hits: string[] = [];
for (const file of files) {
  if (pattern.test(file)) hits.push(`${file}: file path`);
  const abs = path.join(root, file);
  if (!existsSync(abs)) continue;
  const lines = readFileSync(abs, 'latin1').split('\n');
  lines.forEach((line, i) => {
    if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

if (hits.length > 0) {
  console.error(`The product name must only appear in src/shared/brand.ts (found ${hits.length}):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
console.log(`check-name: ${files.length} files clean`);
