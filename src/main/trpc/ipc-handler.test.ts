import { ipcLink } from '@shared/trpc-ipc/link';
import type { ClientMessage, ServerMessage } from '@shared/trpc-ipc/protocol';
import { createTRPCClient, TRPCClientError } from '@trpc/client';
import { initTRPC, TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createIpcHandler } from './ipc-handler';

const t = initTRPC.context<{ windowId: number }>().create({ isServer: true });
const events: string[] = [];

const testRouter = t.router({
  whoami: t.procedure.query(({ ctx }) => ctx.windowId),
  double: t.procedure.input(z.object({ n: z.number() })).mutation(({ input }) => input.n * 2),
  forbidden: t.procedure.query(() => {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'nope' });
  }),
  ticks: t.procedure.subscription(async function* ({ signal }) {
    try {
      for (let i = 0; !signal?.aborted; i++) {
        yield i;
        await new Promise((r) => setTimeout(r, 5));
      }
    } finally {
      events.push('ticks finished');
    }
  }),
  finite: t.procedure.subscription(async function* () {
    yield 'a';
    yield 'b';
  }),
});

function connect(windowId = 7) {
  const handler = createIpcHandler({
    router: testRouter,
    createContext: (peer) => ({ windowId: peer.id }),
  });
  let listener: (m: ServerMessage) => void = () => {};
  const sent: ClientMessage[] = [];
  const client = createTRPCClient<typeof testRouter>({
    links: [
      ipcLink({
        send: (message) => {
          sent.push(message);
          // Structured clone, as Electron IPC does.
          handler.handle(
            { id: windowId, send: (m) => listener(structuredClone(m)) },
            structuredClone(message),
          );
        },
        onMessage: (l) => {
          listener = l;
        },
      }),
    ],
  });
  return { client, handler, sent };
}

describe('tRPC over IPC', () => {
  it('runs queries with the caller window in context', async () => {
    const { client } = connect(42);
    expect(await client.whoami.query()).toBe(42);
  });

  it('runs mutations with validated input', async () => {
    const { client } = connect();
    expect(await client.double.mutate({ n: 21 })).toBe(42);
    const err = await client.double.mutate({ n: 'x' as unknown as number }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCClientError);
    expect(err.data.code).toBe('BAD_REQUEST');
  });

  it('passes error codes and messages through', async () => {
    const { client } = connect();
    const err = await client.forbidden.query().catch((e) => e);
    expect(err).toBeInstanceOf(TRPCClientError);
    expect(err.message).toBe('nope');
    expect(err.data.code).toBe('FORBIDDEN');
  });

  it('streams subscriptions and stops the generator on unsubscribe', async () => {
    const { client, sent } = connect();
    events.length = 0;
    const values: number[] = [];
    await new Promise<void>((resolve) => {
      const sub = client.ticks.subscribe(undefined, {
        onData: (v) => {
          values.push(v);
          if (values.length === 3) {
            sub.unsubscribe();
            resolve();
          }
        },
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(values).toEqual([0, 1, 2]);
    expect(sent.at(-1)?.method).toBe('subscription.stop');
    expect(events).toEqual(['ticks finished']);
  });

  it('completes subscriptions whose generator returns', async () => {
    const { client } = connect();
    const values: string[] = [];
    await new Promise<void>((resolve) => {
      client.finite.subscribe(undefined, { onData: (v) => values.push(v), onComplete: resolve });
    });
    expect(values).toEqual(['a', 'b']);
  });

  it('stops all subscriptions of a disconnected window', async () => {
    const { client, handler } = connect(9);
    events.length = 0;
    await new Promise<void>((resolve) => {
      client.ticks.subscribe(undefined, { onData: () => resolve() });
    });
    handler.disconnect(9);
    await new Promise((r) => setTimeout(r, 30));
    expect(events).toEqual(['ticks finished']);
  });
});
