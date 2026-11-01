/** Quotes a word for POSIX shells unless it is plainly safe. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./~-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}
