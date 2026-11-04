// Prints a version's section of CHANGELOG.md, for its GitHub release notes
// (spec §15.7): everything under "## [<version>]" up to the next "## [".
// Fails when the section is missing or empty, so no release goes out without notes.
//
//   node scripts/changelog-notes.mjs 0.2.0 > notes.md
import fs from 'node:fs';
import path from 'node:path';

/** The section's text, trimmed, or null when there is none. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## [') || /^\[[^\]]+\]:\s/.test(l));
  const text = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim();
  return text || null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const version = (process.argv[2] ?? '').replace(/^v/, '');
  const file = path.join(import.meta.dirname, '..', 'CHANGELOG.md');
  const notes = changelogSection(fs.readFileSync(file, 'utf8'), version);
  if (!notes) {
    console.error(`CHANGELOG.md has no notes for ${version}`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
