import { BRAND } from '@shared/brand';
import { describe, expect, it } from 'vitest';
import { posixLocale, terminalEnv } from './terminal-env';

describe('terminalEnv', () => {
  it('sets terminal capabilities and identifies the app', () => {
    const env = terminalEnv({ PATH: '/bin' }, { locale: 'en-US', appVersion: '1.2.3' });
    expect(env).toMatchObject({
      PATH: '/bin',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: BRAND.displayName,
      TERM_PROGRAM_VERSION: '1.2.3',
      LANG: 'en_US.UTF-8',
    });
  });

  it('keeps an existing locale', () => {
    expect(terminalEnv({ LANG: 'hr_HR.UTF-8' }, { locale: 'en-US', appVersion: '1' }).LANG).toBe(
      'hr_HR.UTF-8',
    );
    expect(terminalEnv({ LC_ALL: 'C' }, { locale: 'en-US', appVersion: '1' }).LANG).toBeUndefined();
  });

  it('converts app locales', () => {
    expect(posixLocale('hr')).toBe('hr.UTF-8');
    expect(posixLocale('pt-br')).toBe('pt_BR.UTF-8');
  });
});
