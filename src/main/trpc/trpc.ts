import { initTRPC } from '@trpc/server';

export interface Context {
  /** WebContents id of the window that made the call. */
  windowId: number;
}

const t = initTRPC.context<Context>().create({ isServer: true });

export const router = t.router;
export const publicProcedure = t.procedure;
