import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { fromListener } from './events';

function source() {
  const emitter = new EventEmitter();
  return {
    emitter,
    register: (listener: (v: number) => void) => {
      emitter.on('v', listener);
      return () => emitter.off('v', listener);
    },
  };
}

describe('fromListener', () => {
  it('yields queued values in order and unregisters on abort', async () => {
    const { emitter, register } = source();
    const controller = new AbortController();
    const values: number[] = [];
    const done = (async () => {
      for await (const v of fromListener(register, controller.signal)) {
        values.push(v);
        if (v === 3) controller.abort();
      }
    })();
    emitter.emit('v', 1);
    emitter.emit('v', 2);
    await new Promise((r) => setTimeout(r, 0));
    emitter.emit('v', 3);
    await done;
    expect(values).toEqual([1, 2, 3]);
    expect(emitter.listenerCount('v')).toBe(0);
  });

  it('delivers events whose payload is undefined', async () => {
    const emitter = new EventEmitter();
    const register = (listener: (v: undefined) => void) => {
      emitter.on('v', listener);
      return () => emitter.off('v', listener);
    };
    const controller = new AbortController();
    let count = 0;
    const done = (async () => {
      for await (const _ of fromListener(register, controller.signal)) {
        if (++count === 2) controller.abort();
      }
    })();
    emitter.emit('v', undefined);
    emitter.emit('v', undefined);
    await done;
    expect(count).toBe(2);
  });

  it('ends while waiting when the signal aborts', async () => {
    const { emitter, register } = source();
    const controller = new AbortController();
    const done = (async () => {
      for await (const _ of fromListener(register, controller.signal)) {
        // no values are emitted
      }
    })();
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await done;
    expect(emitter.listenerCount('v')).toBe(0);
  });
});
