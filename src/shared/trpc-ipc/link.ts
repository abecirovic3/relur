import { TRPCClientError, type TRPCLink } from '@trpc/client';
import type { AnyTRPCRouter } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import type { ServerMessage, TrpcTransport } from './protocol';

interface Pending {
  onMessage(message: ServerMessage): void;
}

/** tRPC client link that sends operations over Electron IPC (see ipc-handler.ts). */
export function ipcLink<TRouter extends AnyTRPCRouter>(
  transport: TrpcTransport,
): TRPCLink<TRouter> {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  transport.onMessage((message) => pending.get(message.id)?.onMessage(message));

  return () =>
    ({ op }) =>
      observable((observer) => {
        const id = nextId++;
        let done = false;
        const finish = () => {
          done = true;
          pending.delete(id);
        };

        pending.set(id, {
          onMessage(message) {
            if ('error' in message) {
              finish();
              observer.error(TRPCClientError.from({ error: message.error }));
            } else if (message.result.type === 'stopped') {
              finish();
              observer.complete();
            } else {
              observer.next({ result: { type: 'data', data: message.result.data } });
              if (op.type !== 'subscription') {
                finish();
                observer.complete();
              }
            }
          },
        });
        transport.send({ id, method: 'request', type: op.type, path: op.path, input: op.input });

        return () => {
          if (done) return;
          finish();
          if (op.type === 'subscription') transport.send({ id, method: 'subscription.stop' });
        };
      });
}
