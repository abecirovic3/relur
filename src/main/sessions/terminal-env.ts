import { BRAND } from '@shared/brand';
import type { Env } from '../env/scrub';

/** `en-US` → `en_US.UTF-8`. */
export function posixLocale(locale: string): string {
  const [language, region] = locale.split(/[-_]/);
  if (!language) return 'en_US.UTF-8';
  return `${language.toLowerCase()}${region ? `_${region.toUpperCase()}` : ''}.UTF-8`;
}

/**
 * Variables every terminal session gets on top of its process environment.
 * Apps launched from the macOS GUI have no LANG, which garbles non-ASCII
 * output, so one is derived from the app locale when no locale is set.
 */
export function terminalEnv(env: Env, options: { locale: string; appVersion: string }): Env {
  const out: Env = {
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: BRAND.displayName,
    TERM_PROGRAM_VERSION: options.appVersion,
  };
  if (!out.LANG && !out.LC_ALL && !out.LC_CTYPE) out.LANG = posixLocale(options.locale);
  return out;
}
