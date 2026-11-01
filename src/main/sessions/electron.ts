import {
  TERMINAL_PORT_CHANNEL,
  type TerminalClientMessage,
  type TerminalPortInfo,
} from '@shared/terminal-protocol';
import { MessageChannelMain, type WebContents } from 'electron';
import type { SessionHost } from './host';

function isInput(message: unknown): message is TerminalClientMessage {
  const m = message as Partial<TerminalClientMessage> | null;
  return m?.type === 'input' && typeof m.data === 'string';
}

/**
 * Attaches a window's terminal view to a session over a new MessagePort. The
 * session is detached when the window closes the port, reloads or goes away.
 */
export function attachToWindow(
  host: SessionHost,
  contents: WebContents,
  info: TerminalPortInfo,
): void {
  const { port1, port2 } = new MessageChannelMain();
  let open = true;
  const attachment = host.attach(info.sessionId, {
    send: (message) => {
      if (open) port1.postMessage(message);
    },
    close: () => {
      open = false;
      port1.close();
    },
  });
  port1.on('message', (event) => {
    if (isInput(event.data)) attachment.input(event.data.data);
  });
  port1.on('close', () => {
    open = false;
    attachment.detach();
  });
  port1.start();
  contents.postMessage(TERMINAL_PORT_CHANNEL, info, [port2]);
}
