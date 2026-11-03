/** Checks for Add project's New repository and Clone from URL (spec §6.1). */

/**
 * Why `name` can't be a new repository's folder name, or null (spec §6.1): one
 * path segment the file systems of macOS and Linux both accept, that doesn't
 * read as a command line option.
 */
export function repoNameProblem(name: string): string | null {
  if (name.trim() === '') return 'Enter a name';
  if (name === '.' || name === '..') return `"${name}" can't be a folder name`;
  if (/[/\\]/.test(name)) return 'A name can\'t contain "/" or "\\"';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses.
  if (/[\u0000-\u001f\u007f]/.test(name)) return "A name can't contain control characters";
  if (name.startsWith('-')) return 'A name can\'t start with "-"';
  if (name !== name.trimStart()) return "A name can't start with a space";
  if (/[ .]$/.test(name)) return "A name can't end with a space or a dot";
  if (new TextEncoder().encode(name).length > 255) return 'The name is too long';
  return null;
}

/**
 * The folder name `git clone` would choose for `url` (spec §6.1): its last
 * path segment, without a trailing `/` or `.git`. Empty when there is none.
 */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, '');
  const last = trimmed.split(/[/\\:]/).pop() ?? '';
  return last.replace(/\.git$/, '').replace(/\.bundle$/, '');
}
