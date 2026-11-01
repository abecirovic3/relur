import { ipcLink } from '@shared/trpc-ipc/link';
import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient } from '@trpc/client';
import type { inferRouterOutputs } from '@trpc/server';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { AppRouter } from '../../main/trpc/router';

export const queryClient = new QueryClient({
  defaultOptions: {
    // Data comes from the local main process: no network retries or refetch on focus.
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: Number.POSITIVE_INFINITY },
    mutations: { retry: false },
  },
});

export const trpcClient = createTRPCClient<AppRouter>({ links: [ipcLink(window.bridge.trpc)] });

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export type AppRouterOutputs = inferRouterOutputs<AppRouter>;
