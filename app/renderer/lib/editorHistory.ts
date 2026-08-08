import { useCallback, useEffect, useRef, useState } from "react";

export const EDITOR_HISTORY_LIMIT = 50;

/** Framework-independent bounded history used by both canvas editors and focused verifiers. */
export class BoundedEditorHistory<T> {
  private past: T[] = [];
  private future: T[] = [];
  private present: T;

  constructor(initial: T, private readonly equals: (left: T, right: T) => boolean, private readonly limit = EDITOR_HISTORY_LIMIT) {
    this.present = initial;
  }

  record(next: T): void {
    if (this.equals(this.present, next)) return;
    this.past = [...this.past, this.present].slice(-this.limit);
    this.present = next;
    this.future = [];
  }

  reset(next: T): void {
    this.present = next;
    this.past = [];
    this.future = [];
  }

  undo(): T | undefined {
    const previous = this.past.pop();
    if (previous === undefined) return undefined;
    this.future.push(this.present);
    this.present = previous;
    return previous;
  }

  redo(): T | undefined {
    const next = this.future.pop();
    if (next === undefined) return undefined;
    this.past.push(this.present);
    this.present = next;
    return next;
  }

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoDepth(): number { return this.past.length; }
  get redoDepth(): number { return this.future.length; }
  isPresent(candidate: T): boolean { return this.equals(this.present, candidate); }
}

/**
 * Observe saveable editor state. Mutations settling within one short window become one transaction,
 * which batches paired node+edge edits and property typing while drag already reports only at end.
 */
export function useEditorHistory<T>(
  value: T,
  apply: (next: T) => void,
  equals: (left: T, right: T) => boolean,
  coalesceMs = 300
) {
  const historyRef = useRef(new BoundedEditorHistory(value, equals));
  const latestRef = useRef(value);
  const pendingRef = useRef<T | null>(null);
  const timerRef = useRef<number | null>(null);
  const applyingRef = useRef(false);
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });

  const publish = useCallback(() => {
    const history = historyRef.current;
    setAvailability({ canUndo: history.canUndo || pendingRef.current !== null, canRedo: history.canRedo });
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) historyRef.current.record(pending);
    publish();
  }, [publish]);

  useEffect(() => {
    latestRef.current = value;
    if (applyingRef.current) {
      applyingRef.current = false;
      return;
    }
    if (historyRef.current.isPresent(value)) {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      publish();
      return;
    }
    pendingRef.current = value;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flush, coalesceMs);
    publish();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [coalesceMs, flush, publish, value]);

  const undo = useCallback(() => {
    flush();
    const previous = historyRef.current.undo();
    if (previous === undefined) return;
    applyingRef.current = true;
    latestRef.current = previous;
    apply(previous);
    publish();
  }, [apply, flush, publish]);

  const redo = useCallback(() => {
    flush();
    const next = historyRef.current.redo();
    if (next === undefined) return;
    applyingRef.current = true;
    latestRef.current = next;
    apply(next);
    publish();
  }, [apply, flush, publish]);

  const reset = useCallback((next: T) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    applyingRef.current = true;
    latestRef.current = next;
    historyRef.current.reset(next);
    publish();
  }, [publish]);

  return { ...availability, undo, redo, reset };
}

/** Native editable controls retain their own local undo stack. */
export function isNativeUndoTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}
