/**
 * Raw terminal output kept for replay when a view attaches. Capped in bytes
 * (UTF-16 code units, close enough) rather than lines; when trimming, it cuts
 * at a line break so a replay rarely starts inside an escape sequence.
 */
export class Scrollback {
  private chunks: string[] = [];
  private size = 0;
  /** Characters trimmed off the front so far; with `size`, positions in the whole output. */
  private dropped = 0;

  constructor(private readonly limit: number) {}

  push(data: string): void {
    this.chunks.push(data);
    this.size += data.length;
    if (this.size <= this.limit) return;

    let text = this.chunks.join('').slice(this.size - this.limit);
    const newline = text.indexOf('\n');
    if (newline !== -1) text = text.slice(newline + 1);
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

  text(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')];
    return this.chunks[0] ?? '';
  }
}
