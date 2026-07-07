/**
 * Cooperative + forceful cancellation. The engine creates one source per instance; the token is
 * threaded into PlaywrightRunner/StepExecutor. `cancel()` runs registered handlers (closing the
 * live browser runtime is the key one) so in-flight Playwright actions reject immediately —
 * cancellation is a hard stop, not a status label.
 */

export class CancelledError extends Error {
  constructor(reason?: string) {
    super(`Execution cancelled${reason ? `: ${reason}` : ""}.`);
    this.name = "CancelledError";
  }
}

export interface CancellationToken {
  readonly cancelled: boolean;
  readonly reason?: string;
  throwIfCancelled(): void;
  /** Register a cancel handler; runs immediately (async) if already cancelled. Returns unsubscribe. */
  onCancel(handler: () => Promise<void> | void): () => void;
}

export class CancellationTokenSource {
  private cancelledFlag = false;
  private cancelReason: string | undefined;
  private readonly handlers = new Set<() => Promise<void> | void>();
  private cancelPromise: Promise<void> | undefined;

  readonly token: CancellationToken;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const source = this;
    this.token = {
      get cancelled() {
        return source.cancelledFlag;
      },
      get reason() {
        return source.cancelReason;
      },
      throwIfCancelled() {
        if (source.cancelledFlag) throw new CancelledError(source.cancelReason);
      },
      onCancel(handler) {
        if (source.cancelledFlag) {
          void Promise.resolve().then(() => handler());
          return () => undefined;
        }
        source.handlers.add(handler);
        return () => source.handlers.delete(handler);
      }
    };
  }

  /** Idempotent; resolves when every cancel handler has run (best-effort). */
  cancel(reason?: string): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    this.cancelledFlag = true;
    this.cancelReason = reason;
    const handlers = [...this.handlers];
    this.handlers.clear();
    this.cancelPromise = (async () => {
      for (const handler of handlers) {
        try {
          await handler();
        } catch {
          // Cancel handlers are best-effort; one failing must not stop the rest.
        }
      }
    })();
    return this.cancelPromise;
  }
}
