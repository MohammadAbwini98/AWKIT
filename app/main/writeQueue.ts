/**
 * Minimal serial async queue used to make settings persistence safe.
 *
 * Tasks run one at a time in FIFO order, so a read-modify-write of the settings file is
 * atomic with respect to other mutations and no two physical writes overlap. A rejected task
 * is isolated: its failure surfaces on the promise returned to *its* caller, but never blocks
 * or poisons the tasks queued behind it (the internal chain is caught on both paths). `flush`
 * resolves once everything queued *so far* has settled — call it on app shutdown so the last
 * fire-and-forget mutation lands before the process exits.
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  flush(): Promise<void>;
  /** Number of tasks queued or running right now (for diagnostics/tests). */
  readonly size: number;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      pending += 1;
      // Run `task` whether the previous task fulfilled or rejected — a failed write must not
      // stop the queue. The caller's returned promise still rejects on failure (their concern).
      const result = tail.then(task, task);
      // The chain tail always resolves so the next task is never blocked by a rejection, and
      // this internal `.then` has a rejection handler so it never becomes an unhandled rejection.
      tail = result.then(
        () => {
          pending -= 1;
        },
        () => {
          pending -= 1;
        }
      );
      return result;
    },
    flush(): Promise<void> {
      return tail.then(
        () => undefined,
        () => undefined
      );
    },
    get size(): number {
      return pending;
    }
  };
}
