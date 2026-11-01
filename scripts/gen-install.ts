/**
 * Writes install.sh from scripts/install.template.sh with the values in
 * src/shared/brand.ts, so the product, its commands and the GitHub repository are
 * named in one place. `npm run gen:install`; a test checks it's up to date.
 */
import fs from 'node:fs';
import path from 'node:path';
import { BRAND } from '../src/shared/brand';

const root = path.resolve(__dirname, '..');

/** install.sh as generated from the template. */
export function installScript(): string {
  const values: Record<string, string> = {
    APP: BRAND.displayName,
    HELPER: BRAND.helperCommand,
    CLI: BRAND.cliCommand,
    SLUG: BRAND.slug,
    LINUX_EXE: BRAND.linuxExecutable,
    OWNER: BRAND.github.owner,
    REPO: BRAND.github.repo,
    PREFIX: BRAND.envPrefix,
    OLD_APP: BRAND.legacy.displayName,
    OLD_CLI: BRAND.legacy.cliCommand,
  };
  const template = fs.readFileSync(path.join(root, 'scripts', 'install.template.sh'), 'utf8');
  return template.replace(/@([A-Z_]+)@/g, (whole, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Unknown placeholder ${whole} in install.template.sh`);
    return value;
  });
}

if (require.main === module) {
  fs.writeFileSync(path.join(root, 'install.sh'), installScript(), { mode: 0o755 });
  console.log('install.sh');
}
