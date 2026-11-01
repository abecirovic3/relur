import type { TrpcTransport } from './trpc-ipc/protocol';

/** Everything the preload script exposes to windows, as `window.bridge`. */
export interface PreloadBridge {
  trpc: TrpcTransport;
}
