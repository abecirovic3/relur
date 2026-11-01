/**
 * Import first in every test driver: drops the app's own variables inherited
 * from the environment (a run started in one of the app's terminals has
 * <prefix>CONFIG_DIR, <prefix>BRIDGE_URL and the like), so a test can never
 * reach the running app or the user's real settings. Variables a test needs
 * are set explicitly afterwards.
 */
import { BRAND } from '../../src/shared/brand';

export function dropInheritedAppEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const dropped = Object.keys(env).filter((key) => key.startsWith(BRAND.envPrefix));
  for (const key of dropped) delete env[key];
  return dropped;
}

dropInheritedAppEnv();
