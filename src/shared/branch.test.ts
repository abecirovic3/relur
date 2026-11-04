import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { branchFromTemplate, numberedBranch, slugify, validBranchName } from './branch';
import { parseTask } from './tasks';

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

/** Whether git takes `name` as a branch name. */
const gitAccepts = (name: string) => {
  try {
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'ignore' });
    return !name.startsWith('-');
  } catch {
    return false;
  }
};

describe('branch names from any task text (spec §7.1)', () => {
  const from = (template: string, text: string) => {
    const { id, title } = parseTask(text);
    return branchFromTemplate(template, { id, title });
  };

  it('gives the expected branch for each kind of text', () => {
    const t = '{id}-{slug}';
    expect(from(t, 'Landing page with Astro')).toBe('landing-page-with-astro');
    expect(from(t, 'landing')).toBe('landing');
    expect(from(t, 'shop-landing')).toBe('shop-landing');
    expect(from(t, 'ABC-99999')).toBe('ABC-99999');
    expect(from(t, 'abc-12')).toBe('abc-12');
    expect(from(t, 'Fix: a..b ~^:?*[\\ @{ x.lock')).toBe('fix-a-b-x-lock');
    expect(from('feature/{id}-{slug}', 'Landing page with Astro')).toBe(
      'feature/landing-page-with-astro',
    );
    expect(from('feature/{id}-{slug}', 'ABC-99999')).toBe('feature/ABC-99999');
  });

  it('fills a template without {slug} from text without an id', () => {
    expect(from('{id}', 'Landing page with Astro')).toBe('landing-page-with-astro');
    expect(from('{id}', 'abc-12')).toBe('abc-12');
    expect(from('{id}', 'ABC-12 Fix login')).toBe('ABC-12');
    expect(from('task/{id}', 'landing')).toBe('task/landing');
  });

  it('names text that slugs to nothing "task"', () => {
    expect(from('{id}-{slug}', '日本語のタスク')).toBe('task');
    expect(from('{id}-{slug}', '..')).toBe('task');
    expect(from('{id}', '~~~')).toBe('task');
    expect(from('{id}-{slug}', '')).toBe('');
  });

  it('replaces what git refuses, whatever the template', () => {
    expect(from('{slug}.lock', 'landing')).toBe('landing-lock');
    expect(from('wip..{slug}', 'landing')).toBe('wip-landing');
    expect(from('.hidden/{slug}', 'landing')).toBe('hidden/landing');
    expect(from('a b:{slug}', 'landing')).toBe('a-b-landing');
    expect(from('@{slug}@{', 'x')).toBe('@x');
  });

  it('gives a name git accepts for every input', () => {
    const texts = [
      'Landing page with Astro',
      'landing',
      'shop-landing',
      'ABC-99999',
      'abc-12',
      'Fix: a..b ~^:?*[\\ @{ x.lock',
      '..',
      '日本語のタスク',
      'Ünïcödé émoji 🚀',
      '-leading dash',
      'ABC-12 .hidden/',
    ];
    const templates = [
      '{id}-{slug}',
      'feature/{id}-{slug}',
      '{id}',
      '{slug}',
      '{slug}.lock',
      '.x/{id}..{slug}/',
    ];
    for (const template of templates) {
      for (const text of texts) {
        const branch = from(template, text);
        expect(gitAccepts(branch), `${template} with "${text}" gave "${branch}"`).toBe(true);
      }
    }
  });
});

describe('validBranchName', () => {
  it('keeps valid names and replaces what git refuses', () => {
    expect(validBranchName('feature/PROJ-1-fix')).toBe('feature/PROJ-1-fix');
    expect(validBranchName('my branch')).toBe('my-branch');
    expect(validBranchName('a~b^c:d?e*f[g\\h')).toBe('a-b-c-d-e-f-g-h');
    expect(validBranchName('x..y')).toBe('x-y');
    expect(validBranchName('x@{y')).toBe('x-y');
    expect(validBranchName('a//b/')).toBe('a/b');
    expect(validBranchName('.a/b.lock/c.')).toBe('a/b-lock/c');
    expect(validBranchName('-x')).toBe('x');
    expect(validBranchName('@')).toBe('');
    expect(validBranchName('HEAD')).toBe('');
  });

  it('numbers a taken name', () => {
    expect(numberedBranch('landing', 2)).toBe('landing-2');
  });
});
