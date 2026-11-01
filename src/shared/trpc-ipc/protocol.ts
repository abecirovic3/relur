import type { TRPCErrorShape } from '@trpc/server/rpc';

/** IPC channel that carries tRPC traffic between the main process and windows. */
export const TRPC_CHANNEL = 'trpc';

export type ProcedureKind = 'query' | 'mutation' | 'subscription';

export type ClientMessage =
  | { id: number; method: 'request'; type: ProcedureKind; path: string; input: unknown }
  | { id: number; method: 'subscription.stop' };

export type ServerMessage =
  | { id: number; result: { type: 'data'; data: unknown } }
  | { id: number; result: { type: 'stopped' } }
  | { id: number; error: TRPCErrorShape };

/** What the preload script exposes to the renderer for tRPC. */
export interface TrpcTransport {
  send(message: ClientMessage): void;
  /** Registers the single listener for server messages. */
  onMessage(listener: (message: ServerMessage) => void): void;
}
