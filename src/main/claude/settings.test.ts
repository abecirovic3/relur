import { BRAND } from '@shared/brand';
import { describe, expect, it } from 'vitest';
import { claudeSettings, HOOK_EVENTS, LINK_ASK_RULES } from './settings';

describe('claudeSettings', () => {
  it('is empty without the helper', () => {
    expect(claudeSettings()).toEqual({});
  });

  it('asks before the link command with askBeforeLink (spec §21.9)', () => {
    expect(claudeSettings({ askBeforeLink: true })).toEqual({
      permissions: {
        ask: [`Bash(${BRAND.cliCommand} link:*)`, `Bash(${BRAND.helperCommand} link:*)`],
      },
    });
    expect(claudeSettings({ helper: '/h', askBeforeLink: true })).toMatchObject({
      permissions: { ask: LINK_ASK_RULES },
      hooks: expect.any(Object),
    });
    expect(claudeSettings({ helper: '/h' })).not.toHaveProperty('permissions');
  });

  it('runs the helper for all seven hook events and the status line (spec §9.3)', () => {
    const settings = claudeSettings({ helper: '/app/bin helper' }) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
      statusLine: { type: string; command: string };
    };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.Notification?.[0]?.hooks).toEqual([
      { type: 'command', command: `'/app/bin helper' hook Notification` },
    ]);
    expect(settings.hooks.PostToolUse?.[0]?.matcher).toBe('*');
    expect(settings.statusLine).toEqual({
      type: 'command',
      command: `'/app/bin helper' statusline`,
    });
  });

  it('adds marker hooks for all seven events and a marker status line with the dev flag', () => {
    const settings = claudeSettings({ markersDir: "/tmp/it's" }) as {
      hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
      statusLine: { command: string };
    };
    expect(Object.keys(settings.hooks)).toEqual([...HOOK_EVENTS]);
    expect(settings.hooks.PreToolUse?.[0]?.matcher).toBe('*');
    expect(settings.hooks.Stop?.[0]?.matcher).toBeUndefined();
    expect(settings.hooks.Stop?.[0]?.hooks[0]?.command).toBe(
      `printf '%s\\n' 'Stop' >> '/tmp/it'\\''s/injected.log'`,
    );
    expect(settings.statusLine.command).toContain("printf 'injected-statusline'");
  });
});
