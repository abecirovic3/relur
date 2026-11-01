import { TERMINAL_PORT_CHANNEL, type TerminalPortInfo } from '@shared/terminal-protocol';
import { trpcClient } from '../trpc';

const waiters = new Map<string, (port: MessagePort) => void>();

// The preload script forwards each terminal port with window.postMessage.
window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as Partial<TerminalPortInfo> & { channel?: string };
  if (data?.channel !== TERMINAL_PORT_CHANNEL || !data.attachId) return;
  const port = event.ports[0];
  if (!port) return;
  const waiter = waiters.get(data.attachId);
  if (!waiter) {
    port.close();
    return;
  }
  waiters.delete(data.attachId);
  waiter(port);
});

/** Opens a MessagePort to a terminal session; the first message replays its scrollback. */
export async function openTerminalPort(sessionId: string): Promise<MessagePort> {
  const attachId = crypto.randomUUID();
  const port = new Promise<MessagePort>((resolve, reject) => {
    waiters.set(attachId, resolve);
    setTimeout(() => {
      if (waiters.delete(attachId)) reject(new Error('The terminal did not connect'));
    }, 5_000);
  });
  await trpcClient.sessions.attach.mutate({ sessionId, attachId });
  return port;
}
