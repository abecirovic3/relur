import type { Terminal } from '@xterm/xterm';

/**
 * Wheel scrolling in programs that track the mouse, such as Claude Code's
 * full-screen view. xterm sends at most one wheel report per wheel event, and
 * for pixel deltas only once they add up to a line after scaling them by 0.3.
 * Trackpad scrolling then stalls for several events and jumps, and fast swipes
 * lose most of their distance. Native terminals send one report per line of
 * movement; this handler does the same by turning each line into a one-line
 * wheel event that xterm reports as usual.
 *
 * Without mouse tracking (shells, scrollback) xterm's own handling is kept.
 */
export function mouseWheelHandler(
  term: Terminal,
  screenHeight: () => number,
): (event: WheelEvent) => boolean {
  const synthetic = new WeakSet<Event>();
  let partial = 0;

  return (event) => {
    if (synthetic.has(event) || term.modes.mouseTrackingMode === 'none') return true;
    // xterm ignores Shift+wheel in this mode; keep that.
    if (event.deltaY === 0 || event.shiftKey) return true;

    const lineHeight = screenHeight() / term.rows;
    let lines = event.deltaY;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PIXEL) lines /= lineHeight || 1;
    else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) lines *= term.rows;
    const { scrollSensitivity = 1, fastScrollSensitivity = 5 } = term.options;
    lines *= event.altKey ? fastScrollSensitivity : scrollSensitivity;

    // A change of direction drops what was left over from the other one.
    if (Math.sign(lines) !== Math.sign(partial)) partial = 0;
    partial += lines;
    const whole = Math.trunc(partial);
    partial -= whole;

    const count = Math.min(Math.abs(whole), term.rows);
    for (let i = 0; i < count; i++) {
      const line = new WheelEvent('wheel', {
        deltaY: Math.sign(whole),
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        bubbles: true,
        cancelable: true,
      });
      synthetic.add(line);
      event.target?.dispatchEvent(line);
    }
    event.preventDefault();
    return false;
  };
}
