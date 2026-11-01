import type { TerminalMark } from '@shared/terminal-protocol';
import type { IDecoration, IDisposable, IMarker, Terminal } from '@xterm/xterm';
import { keysOf, LineText, letters, type Needle } from './locate';

/** What the prompt navigator shows, and the display mode (spec §6.8). */
export interface NavigatorState {
  /** Prompts with a marker in the normal buffer. */
  count: number;
  /** 1-based prompt at the top of the viewport; 0 above the first. */
  current: number;
  /** Claude draws in the alternate screen: markers and buttons are hidden (D9). */
  alternate: boolean;
}

interface Mark {
  mark: TerminalMark;
  marker: IMarker | undefined;
  decoration: IDecoration | undefined;
}

/** How far above the cursor a new prompt or response is looked for. */
const SEARCH_LINES = 3000;
/** Quiet time after a resize before the lines are searched again (Claude reprints). */
const SETTLE_MS = 600;
const SETTLE_MAX_MS = 4000;

const needle = (mark: TerminalMark): Needle | null =>
  mark.kind === 'response'
    ? { text: mark.text, at: 'end' }
    : mark.text
      ? { text: mark.text, at: 'start' }
      : null;

/**
 * Conversation aids of a Claude tab (spec §6.8): an xterm marker at the line
 * of each prompt and response end, a prompt number in the gutter, and a Copy
 * button at the right of the line where each response ends. Lines are found
 * by the prompt's or response's text, when the hook arrives and again after
 * a resize (Claude Code reprints the conversation then); a response that
 * can't be found gets no button. Claude Code's own output is never touched.
 * In the alternate screen (full-screen renderer) none of it applies.
 */
export class ConversationAids {
  private readonly marks: Mark[] = [];
  private readonly disposables: IDisposable[] = [];
  private settle: {
    timer: ReturnType<typeof setTimeout>;
    since: number;
    /** Search everything again, rather than only check the placed marks. */
    full: boolean;
  } | null = null;

  constructor(
    private readonly term: Terminal,
    private readonly handlers: {
      copy: (text: string) => void;
      change: (state: NavigatorState) => void;
    },
  ) {
    this.disposables.push(
      term.buffer.onBufferChange(() => {
        // Back from the alternate screen: the lines may have moved meanwhile.
        if (!this.alternate) this.relocateLater();
        this.emit();
      }),
      term.onScroll(() => this.emit()),
      term.onResize(() => this.relocateLater()),
      // Claude can erase what it printed (/clear clears the screen): once the
      // output settles, marks whose line no longer shows their text are searched again.
      term.onWriteParsed(() => this.relocateLater(false)),
    );
  }

  get alternate(): boolean {
    return this.term.buffer.active.type === 'alternate';
  }

  private get cursorLine(): number {
    const buffer = this.term.buffer.active;
    return buffer.baseY + buffer.cursorY;
  }

  /** The buffer's text lines from `from` to the cursor line. */
  private lines(from: number): LineText {
    const buffer = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = from; y <= this.cursorLine; y++) {
      lines.push(buffer.getLine(y)?.translateToString(true) ?? '');
    }
    return new LineText(lines);
  }

  /** Adds a prompt or response where the output has got to (call in write order). */
  add(mark: TerminalMark): void {
    const entry: Mark = { mark, marker: undefined, decoration: undefined };
    this.marks.push(entry);
    // Markers belong to xterm's normal buffer; the alternate screen has none (D9).
    if (!this.alternate) {
      const wanted = needle(mark);
      if (wanted) {
        const from = Math.max(0, this.cursorLine - SEARCH_LINES);
        const text = this.lines(from);
        const found = text.findBefore(wanted, text.endOf(this.cursorLine - from));
        if (found) this.place(entry, from + found.line);
        // Not printed yet (Claude echoes a prompt after its hook): once output settles.
        else this.relocateLater();
      } else {
        // A prompt without its text: where the cursor is when the hook arrives.
        this.place(entry, this.cursorLine);
      }
    }
    this.emit();
  }

  /**
   * Once the output has been quiet for a moment: finds every line again
   * (`full`), or only checks the placed marks and searches again if one moved.
   */
  private relocateLater(full = true): void {
    if (this.marks.length === 0) return;
    const since = this.settle?.since ?? Date.now();
    const all = full || (this.settle?.full ?? false);
    if (this.settle) clearTimeout(this.settle.timer);
    const wait = Math.min(SETTLE_MS, Math.max(0, since + SETTLE_MAX_MS - Date.now()));
    const run = () => {
      this.settle = null;
      if (all || this.moved()) this.relocate();
    };
    this.settle = { timer: setTimeout(run, wait), since, full: all };
  }

  /** Whether a placed mark's line no longer shows the start or end of its text. */
  private moved(): boolean {
    if (this.alternate) return false;
    return this.marks.some(
      ({ mark, marker }) => marker && !marker.isDisposed && !this.shows(mark, marker.line),
    );
  }

  /** Whether buffer line `line` shows the start of a prompt or the end of a response. */
  private shows(mark: TerminalMark, line: number): boolean {
    const wanted = needle(mark);
    const keys = wanted ? keysOf(wanted) : [];
    if (keys.length === 0) return true;
    const buffer = this.term.buffer.active;
    const text = (from: number, to: number) => {
      let joined = '';
      for (let y = from; y <= to; y++) joined += buffer.getLine(y)?.translateToString(true) ?? '';
      return letters(joined);
    };
    // A key spans a few lines (a list or table maybe 20); a button may sit on the blank line below.
    const shown =
      mark.kind === 'response' ? text(Math.max(0, line - 20), line) : text(line, line + 20);
    return keys.some((key) =>
      mark.kind === 'response' ? shown.endsWith(key) : shown.startsWith(key),
    );
  }

  /** Searches the whole buffer from the bottom up, latest mark first. */
  private relocate(): void {
    if (this.alternate) return;
    const text = this.lines(0);
    let before = text.endOf(this.cursorLine);
    for (const entry of [...this.marks].reverse()) {
      const wanted = needle(entry.mark);
      const found = wanted ? text.findBefore(wanted, before) : null;
      if (found) {
        this.place(entry, found.line);
        before = found.offset;
      } else this.unplace(entry);
    }
    this.emit();
  }

  private unplace(entry: Mark): void {
    const { marker } = entry;
    entry.marker = undefined;
    entry.decoration = undefined;
    marker?.dispose();
  }

  /** Puts the mark's marker and decoration on buffer line `line`. */
  private place(entry: Mark, line: number): void {
    const { mark } = entry;
    if (mark.kind === 'response') {
      // A line full to the right edge: the blank line below, clear of Claude's text.
      const buffer = this.term.buffer.active;
      const full =
        (buffer.getLine(line)?.translateToString(true).length ?? 0) > this.term.cols - 10;
      const below = buffer
        .getLine(line + 1)
        ?.translateToString(true)
        .trim();
      if (full && below === '' && line + 1 <= this.cursorLine) line += 1;
    }
    if (entry.marker?.line === line) return;
    this.unplace(entry);
    const marker = this.term.registerMarker(line - this.cursorLine);
    if (!marker) return;
    const number = this.marks.filter((m) => m.mark.kind === 'prompt').indexOf(entry) + 1;
    const ordinal = this.marks.filter((m) => m.mark.kind === 'response').indexOf(entry);
    const decoration =
      mark.kind === 'prompt'
        ? this.term.registerDecoration({ marker, x: 0, width: 1, layer: 'top' })
        : this.term.registerDecoration({ marker, anchor: 'right', x: 0, width: 8, layer: 'top' });
    decoration?.onRender((el) => {
      if (mark.kind === 'response') {
        // At the right edge of the response's last line, clear of Claude's text.
        // xterm resets these when the terminal resizes, so on every render.
        el.style.left = 'auto';
        el.style.right = '12px';
        el.style.width = 'auto';
      }
      if (el.dataset.ready) return;
      el.dataset.ready = 'true';
      if (mark.kind === 'prompt') {
        // The gutter left of the text (components.md, Claude terminal decorations).
        el.dataset.promptMark = String(number);
        el.className +=
          ' pointer-events-none -ml-9 w-8! text-right font-mono text-xs font-bold text-profile';
        el.textContent = String(number);
      } else {
        el.dataset.responseMark = String(ordinal);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Copy';
        button.title = 'Copy this response, as Markdown';
        button.className =
          'h-5 rounded-md border border-line-strong bg-raised px-2 text-xs text-fg-muted opacity-60 hover:text-fg hover:opacity-100';
        button.addEventListener('mousedown', (e) => e.preventDefault());
        button.addEventListener('click', () => {
          this.handlers.copy(mark.text);
          button.textContent = 'Copied';
          setTimeout(() => {
            button.textContent = 'Copy';
          }, 1500);
        });
        el.append(button);
      }
    });
    entry.marker = marker;
    entry.decoration = decoration;
    marker.onDispose(() => {
      // Trimmed from the scrollback or cleared: the mark stays, without a line.
      if (entry.marker !== marker) return;
      entry.marker = undefined;
      entry.decoration = undefined;
      this.emit();
    });
  }

  private placed(kind: TerminalMark['kind']): Mark[] {
    return this.marks.filter((m) => m.mark.kind === kind && m.marker && !m.marker.isDisposed);
  }

  /** Scrolls so prompt `n` (1-based) sits two lines from the top. */
  goTo(n: number): void {
    const prompt = this.placed('prompt')[n - 1];
    if (prompt?.marker) this.term.scrollToLine(Math.max(0, prompt.marker.line - 2));
  }

  /**
   * Marks for a moment the line where the response with this text ends (the
   * line its Copy button uses, or for one printed before the hooks, such as a
   * resumed conversation's, the line its text is found on), scrolling to it
   * when it isn't on the screen. False in the alternate screen or when it
   * isn't in the buffer.
   */
  reveal(text: string): boolean {
    if (this.alternate) return false;
    // A marker can be stale for a moment after a resize, until Claude's reprint is searched.
    const mark = this.marks.findLast(
      (m) =>
        m.mark.kind === 'response' &&
        m.mark.text === text &&
        m.marker &&
        !m.marker.isDisposed &&
        this.shows(m.mark, m.marker.line),
    );
    let line = mark?.marker?.line;
    if (line === undefined) {
      const lines = this.lines(0);
      line = lines.findBefore({ text, at: 'end' }, lines.endOf(this.cursorLine))?.line;
    }
    if (line === undefined) return false;
    // Off the screen: the end of the response near the bottom, with its text above it.
    const top = this.term.buffer.active.viewportY;
    if (line < top || line > top + this.term.rows - 2) {
      this.term.scrollToLine(Math.max(0, line - this.term.rows + 4));
    }
    const marker = this.term.registerMarker(line - this.cursorLine);
    const flash = marker
      ? this.term.registerDecoration({ marker, x: 0, width: this.term.cols, layer: 'top' })
      : undefined;
    flash?.onRender((el) => {
      // The terminal's width now, not when it was drawn: a panel may have narrowed it.
      el.style.width = '100%';
      if (el.dataset.revealed) return;
      el.dataset.revealed = 'true';
      el.className += ' pointer-events-none bg-profile/20';
    });
    setTimeout(() => marker?.dispose(), 1500);
    return true;
  }

  /** ⌘↑ / ⌘↓: the previous or next prompt. */
  step(delta: -1 | 1): void {
    const { current, count } = this.state();
    if (count === 0) return;
    this.goTo(Math.min(count, Math.max(1, current + delta)));
  }

  state(): NavigatorState {
    const prompts = this.placed('prompt');
    const top = this.term.buffer.active.viewportY + 2;
    let current = 0;
    prompts.forEach((p, i) => {
      if ((p.marker?.line ?? 0) <= top) current = i + 1;
    });
    return {
      count: prompts.length,
      current,
      alternate: this.alternate,
    };
  }

  private emit(): void {
    this.handlers.change(this.state());
  }

  dispose(): void {
    if (this.settle) clearTimeout(this.settle.timer);
    this.settle = null;
    for (const d of this.disposables) d.dispose();
    for (const m of this.marks.splice(0)) m.marker?.dispose();
  }
}
