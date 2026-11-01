import { describe, expect, it } from 'vitest';
import { branchFromTemplate, slugify } from './branch';

describe('slugify', () => {
  it('follows the spec rules', () => {
    expect(slugify('Fix login timeout')).toBe('fix-login-timeout');
    expect(slugify('Čišćenje đaka & žaba')).toBe('ciscenje-djaka-zaba');
    expect(slugify('  --Hello,   World!!  ')).toBe('hello-world');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
  });

  it('cuts long titles at a word boundary, at most 50 characters', () => {
    const slug = slugify(
      'Refactor the session refresh logic so remembered logins survive restarts',
    );
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug).toBe('refactor-the-session-refresh-logic-so-remembered');
  });
});

describe('branchFromTemplate', () => {
  it('fills id and slug, dropping separators next to empty tokens', () => {
    const t = '{id}-{slug}';
    expect(branchFromTemplate(t, { id: 'PROJ-123', title: 'Fix login timeout' })).toBe(
      'PROJ-123-fix-login-timeout',
    );
    expect(branchFromTemplate(t, { id: 'PROJ-123', title: '' })).toBe('PROJ-123');
    expect(branchFromTemplate(t, { id: '', title: 'Fix login timeout' })).toBe('fix-login-timeout');
    expect(branchFromTemplate('feature/{id}-{slug}', { id: '', title: 'Add log' })).toBe(
      'feature/add-log',
    );
    expect(branchFromTemplate(t, { id: '#42', title: 'x' })).toBe('42-x');
  });
});
