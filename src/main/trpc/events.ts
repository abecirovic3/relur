/**
 * Turns a listener registration into an async generator for tRPC subscriptions.
 * Ends when `signal` aborts; values that arrive between pulls are queued.
 */
export async function* fromListener<T>(
  register: (listener: (value: T) => void) => () => void,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  const unregister = register((value) => {
    queue.push(value);
    wake?.();
  });
  const onAbort = () => wake?.();
  signal?.addEventListener('abort', onAbort);
  try {
    while (!signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift() as T;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    unregister();
  }
}
