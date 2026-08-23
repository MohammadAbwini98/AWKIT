/**
 * Between-step pause gate (AWKIT-RUN-001).
 *
 * `Pause Instance` used to flip a pool label while clicks and fills kept firing on the live
 * site. The engine now owns one of these per running instance and hands it to the instance's
 * `StepExecutor`, which awaits {@link ExecutionPauseGate.waitWhilePaused} at the same seam as its
 * cancellation check — BEFORE the next side effect starts. Pause therefore halts step dispatch;
 * Stop interrupts a parked pause immediately instead of waiting for a resume.
 */
export interface ExecutionPauseGate {
  /** True while an operator-requested pause is holding. */
  readonly isPaused: boolean;
  /**
   * Resolves once the pause lifts. `isCancelled` is polled so a cancellation requested during the
   * pause breaks the wait (the next cancellation check then aborts the flow) even if nobody ever
   * resumes the gate.
   */
  waitWhilePaused(isCancelled?: () => boolean): Promise<void>;
}

/** Polling implementation: cheap (a 250 ms tick per paused instance) and impossible to strand. */
export class InstancePauseController implements ExecutionPauseGate {
  private static readonly POLL_MS = 250;

  private paused = false;

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(value: boolean): void {
    this.paused = value;
  }

  async waitWhilePaused(isCancelled?: () => boolean): Promise<void> {
    while (this.paused && !(isCancelled?.() ?? false)) {
      await new Promise((resolve) => setTimeout(resolve, InstancePauseController.POLL_MS));
    }
  }
}
