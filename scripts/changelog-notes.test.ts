import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain script without types
import { changelogSection } from './changelog-notes.mjs';

const sample = `# Changelog

## [Unreleased]

### Added

- Next thing.

## [0.2.0] - 2026-12-01

### Added

- Updates.

## [0.1.0] - 2026-11-02

- First.

[Unreleased]: https://example.com/compare
[0.2.0]: https://example.com/v0.2.0
`;

describe('changelogSection', () => {
  it("gives a version's section, up to the next one", () => {
    expect(changelogSection(sample, '0.2.0')).toBe('### Added\n\n- Updates.');
    expect(changelogSection(sample, '0.1.0')).toBe('- First.');
    expect(changelogSection(sample, '0.3.0')).toBeNull();
  });

  it("has notes for package.json's version in the real CHANGELOG.md, and an Unreleased section", () => {
    const root = path.join(import.meta.dirname, '..');
    const real = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
    const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(changelogSection(real, version)).toMatch(/^### /);
    expect(changelogSection(real, '0.1.0')).toMatch(/^### Added/);
    expect(real).toMatch(/^## \[Unreleased\]$/m);
  });
});
