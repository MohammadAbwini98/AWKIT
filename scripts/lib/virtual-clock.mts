/**
 * A virtual clock for deadline verifiers. `install` swaps the global timers for virtual ones; `run`
 * fires them in time order and lets every promise chain settle between firings. So a 185 s deadline
 * runs on its real timeline in milliseconds.
 *
 * Sound only where nothing awaited does I/O: every await must be a timer or a promise. Real timers
 * created before `install` keep firing in real time, and anything that still waits on a virtual timer
 * after `uninstall` never returns — so shut services down through `settle`, never off the clock.
 */

type VirtualTimer = { at: number; fn: () => void; every?: number };

export function virtualClock() {
  const real = { setTimeout, clearTimeout, setInterval, clearInterval };
  const timers = new Map<number, VirtualTimer>();
  let now = 0;
  let sequence = 0;
  const add = (fn: () => void, ms: unknown, every?: number) => {
    const id = (sequence += 1);
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn, every });
    return { id, unref() { return this; }, ref() { return this; } };
  };
  const clear = (handle: unknown) => void timers.delete((handle as { id?: number } | undefined)?.id ?? -1);

  /** Fire timers in order until `done()` holds or virtual time reaches `untilMs`. */
  async function run(untilMs: number, done: () => boolean = () => false): Promise<void> {
    for (;;) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (done()) return;
      let next: [number, VirtualTimer] | undefined;
      for (const entry of timers) if (!next || entry[1].at < next[1].at) next = entry;
      if (!next || next[1].at > untilMs) {
        now = Math.max(now, untilMs);
        return;
      }
      const [id, timer] = next;
      now = timer.at;
      if (timer.every === undefined) timers.delete(id);
      else timer.at = now + timer.every;
      timer.fn();
    }
  }

  return {
    now: () => now,
    install: () =>
      Object.assign(globalThis, {
        setTimeout: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => add(() => fn(...args), ms),
        setInterval: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => add(() => fn(...args), ms, Math.max(1, Number(ms) || 1)),
        clearTimeout: clear,
        clearInterval: clear
      }),
    uninstall: () => {
      Object.assign(globalThis, real);
      timers.clear();
    },
    run,
    /** The value and the virtual time it settled at, or undefined when it did not settle within the budget. */
    async settle<T>(promise: Promise<T>, budgetMs: number): Promise<{ value: T; atMs: number } | undefined> {
      let result: { value: T; atMs: number } | undefined;
      void promise.then((value) => {
        result = { value, atMs: now };
      });
      await run(now + budgetMs, () => result !== undefined);
      return result;
    }
  };
}
