/**
 * Process-wide durable lock store handle. The ExecutionEngine configures it at startup (dir
 * under the runtime data root); until then durable locking is a no-op and the in-memory locks
 * stand alone (tests / direct runner use). Verifiers configure their own store with temp dirs.
 */
import { DurableLockStore } from "./DurableLockStore";

let store: DurableLockStore | undefined;

export function configureDurableLocks(next: DurableLockStore | undefined): void {
  store = next;
}

export function getDurableLockStore(): DurableLockStore | undefined {
  return store;
}
