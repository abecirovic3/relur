import { type ClientMessage, TRPC_CHANNEL } from '@shared/trpc-ipc/protocol';
import { ipcMain, type WebContents } from 'electron';
import { createIpcHandler } from './ipc-handler';
import { createAppRouter, type Services } from './router';

/** Serves the app router to every window over IPC. */
export function serveTrpcOverIpc(services: Services): void {
  const handler = createIpcHandler({
    router: createAppRouter(services),
    createContext: (peer) => ({ windowId: peer.id }),
  });
  const connected = new Set<WebContents>();

  ipcMain.on(TRPC_CHANNEL, (event, message: ClientMessage) => {
    // Only the app's own top-level frame may call procedures.
    if (event.senderFrame !== event.sender.mainFrame) return;
    const contents = event.sender;
    if (!connected.has(contents)) {
      connected.add(contents);
      const id = contents.id;
      contents.once('destroyed', () => {
        connected.delete(contents);
        handler.disconnect(id);
      });
      // A reload keeps the WebContents but starts a new page whose request ids
      // begin again; the old page's subscriptions must stop, or their messages
      // would answer the new page's requests.
      contents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) handler.disconnect(id);
      });
      contents.on('render-process-gone', () => handler.disconnect(id));
    }
    handler.handle(
      {
        id: contents.id,
        send: (msg) => {
          if (contents.isDestroyed()) return;
          try {
            contents.send(TRPC_CHANNEL, msg);
          } catch {
            // The page is navigating away; its subscriptions are being stopped.
          }
        },
      },
      message,
    );
  });
}
