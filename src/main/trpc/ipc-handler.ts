import type { ClientMessage, ServerMessage } from '@shared/trpc-ipc/protocol';
import {
  type AnyTRPCRouter,
  callTRPCProcedure,
  getTRPCErrorFromUnknown,
  getTRPCErrorShape,
  type inferRouterContext,
} from '@trpc/server';

/** One connected window, identified by its WebContents id. */
export interface IpcPeer {
  id: number;
  send(message: ServerMessage): void;
}

interface Options<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  createContext(peer: IpcPeer): inferRouterContext<TRouter>;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value != null && typeof value === 'object' && Symbol.asyncIterator in value;
}

/**
 * Server side of the IPC link: runs procedures for messages from a window and
 * sends results back. Subscriptions must be async generators.
 */
export function createIpcHandler<TRouter extends AnyTRPCRouter>({
  router,
  createContext,
}: Options<TRouter>) {
  // Running subscriptions per peer, so a closed window stops its own.
  const subscriptions = new Map<number, Map<number, AbortController>>();

  const subsOf = (peer: IpcPeer) => {
    let subs = subscriptions.get(peer.id);
    if (!subs) {
      subs = new Map();
      subscriptions.set(peer.id, subs);
    }
    return subs;
  };

  async function run(peer: IpcPeer, message: Extract<ClientMessage, { method: 'request' }>) {
    const { id, type, path, input } = message;
    const controller = new AbortController();
    if (type === 'subscription') subsOf(peer).set(id, controller);
    let ctx: inferRouterContext<TRouter> | undefined;

    try {
      ctx = createContext(peer);
      const result = await callTRPCProcedure({
        router,
        ctx,
        path,
        type,
        input,
        getRawInput: async () => input,
        signal: controller.signal,
        batchIndex: 0,
      });

      if (type !== 'subscription') {
        peer.send({ id, result: { type: 'data', data: result } });
        return;
      }
      if (!isAsyncIterable(result)) {
        throw new Error(`Subscription "${path}" must be an async generator`);
      }
      const iterator = result[Symbol.asyncIterator]();
      controller.signal.addEventListener('abort', () => void iterator.return?.(), { once: true });
      while (!controller.signal.aborted) {
        const next = await iterator.next();
        if (next.done || controller.signal.aborted) break;
        peer.send({ id, result: { type: 'data', data: next.value } });
      }
      if (!controller.signal.aborted) peer.send({ id, result: { type: 'stopped' } });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const error = getTRPCErrorFromUnknown(cause);
      const shape = getTRPCErrorShape({
        config: router._def._config,
        error,
        type,
        path,
        input,
        ctx,
      });
      peer.send({ id, error: shape });
    } finally {
      if (type === 'subscription') subscriptions.get(peer.id)?.delete(id);
    }
  }

  return {
    handle(peer: IpcPeer, message: ClientMessage): void {
      if (message.method === 'subscription.stop') {
        subscriptions.get(peer.id)?.get(message.id)?.abort();
        return;
      }
      void run(peer, message);
    },

    /** Stops every subscription of a peer whose window went away. */
    disconnect(peerId: number): void {
      for (const controller of subscriptions.get(peerId)?.values() ?? []) controller.abort();
      subscriptions.delete(peerId);
    },
  };
}
