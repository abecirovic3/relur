/** DEC private modes that switch to the alternate screen (1049, 1047, 47), set or reset. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: escape sequences start with ESC.
const SCREEN_MODE = /\x1b\[\?([\d;]+)([hl])/g;
const ALTERNATE_MODES = new Set(['1049', '1047', '47']);

/** The alternate-screen state after `text`, starting from `alternate`. */
export function screenAfter(text: string, alternate: boolean): boolean {
  for (const [, params, final] of text.matchAll(SCREEN_MODE)) {
    if (params?.split(';').some((p) => ALTERNATE_MODES.has(p))) alternate = final === 'h';
  }
  return alternate;
}

/** Enters the alternate screen; a replay starts with it when its kept output began there. */
export const ENTER_ALTERNATE = '\x1b[?1049h';

/**
 * Raw terminal output kept for replay when a view attaches. Capped in bytes
 * (UTF-16 code units, close enough) rather than lines; when trimming, it cuts
 * at a line break so a replay rarely starts inside an escape sequence.
 * It follows the alternate screen in the output (spec §6.8, D9): Claude's
 * full-screen renderer enters it once and then draws far more than is kept,
 * so the `?1049h` is soon trimmed off; `startsAlternate` says the kept output
 * began in the alternate screen.
 */
export class Scrollback {
  private chunks: string[] = [];
  private size = 0;
  /** Characters trimmed off the front so far; with `size`, positions in the whole output. */
  private dropped = 0;
  private alternateAtStart = false;

  constructor(private readonly limit: number) {}

  push(data: string): void {
    this.chunks.push(data);
    this.size += data.length;
    if (this.size <= this.limit) return;

    const all = this.chunks.join('');
    let cut = this.size - this.limit;
    const newline = all.indexOf('\n', cut);
    if (newline !== -1) cut = newline + 1;
    // The cut is at a line break, never inside a mode sequence.
    this.alternateAtStart = screenAfter(all.slice(0, cut), this.alternateAtStart);
    const text = all.slice(cut);
    this.dropped += this.size - text.length;
    this.chunks = [text];
    this.size = text.length;
  }

  /** Position of the first kept character in the session's whole output. */
  get start(): number {
    return this.dropped;
  }

  /** Position just after the last character written. */
  get end(): number {
    return this.dropped + this.size;
  }

  /** Whether the kept output begins in the alternate screen. */
  get startsAlternate(): boolean {
    return this.alternateAtStart;
  }

  text(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')];
    return this.chunks[0] ?? '';
  }
}
