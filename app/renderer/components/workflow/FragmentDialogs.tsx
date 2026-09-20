import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Blocks, Bookmark, TriangleAlert } from "lucide-react";

import { useModalFocusContract } from "../shared/useModalFocusContract";
import type { FlowFragment, FragmentAuditFinding } from "@src/fragments/FlowFragment";
import type { StepType } from "@src/profiles/FlowProfile";

/**
 * L6 — the two Flow Designer fragment surfaces: save a selection as a fragment, and insert a saved
 * one.
 *
 * Neither dialog decides anything. `captureFragment`/`applyFragment` and the main-process audit are
 * the authorities; these components choose a selection, show what the audit said, and refuse to
 * offer a control for an operation that would be refused anyway. A finding shown here is the SAME
 * finding the write path acts on — it is fetched from `fragments:audit`, never recomputed locally,
 * so the preview cannot disagree with the rule.
 *
 * AWKIT-A11Y-001: the modal focus contract comes from `useModalFocusContract`, not from markup
 * copied out of a dialog that happens to have it today.
 */

/** A step the user may put in a fragment. `start`/`end` never appear — the audit blocks them. */
export interface FragmentCandidateStep {
  id: string;
  name: string;
  stepType: StepType;
}

function FindingList({ findings, emptyLabel }: { findings: FragmentAuditFinding[]; emptyLabel: string }) {
  if (findings.length === 0) return <p className="fragment-findings-empty">{emptyLabel}</p>;
  const blocking = findings.filter((entry) => entry.severity === "blocking");
  const advisory = findings.filter((entry) => entry.severity === "advisory");
  return (
    <ul className="fragment-findings" data-testid="fragment-findings">
      {[...blocking, ...advisory].map((entry, index) => (
        <li
          className={entry.severity === "blocking" ? "fragment-finding blocking" : "fragment-finding advisory"}
          data-severity={entry.severity}
          data-code={entry.code}
          key={`${entry.code}-${entry.nodeId ?? entry.edgeId ?? entry.inputKey ?? index}`}
        >
          <span className="fragment-finding-tag">{entry.severity === "blocking" ? "Blocking" : "Advisory"}</span>
          <span>{entry.message}</span>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Save selection as fragment
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export interface SaveFragmentDialogProps {
  flowName: string;
  /** Selectable steps, already filtered to exclude the flow's terminals. */
  steps: FragmentCandidateStep[];
  /** The designer's authoritative selection, used only as the initial seed. */
  seedStepIds: string[];
  /**
   * Capture reads the flow FROM THE STORE, because creation goes through `create` and there is
   * deliberately no blind-write import channel. A dirty editor would therefore capture something
   * other than what the user is looking at, so the dialog refuses instead of capturing a stale graph.
   */
  editorDirty: boolean;
  onCancel: () => void;
  onCapture: (input: { nodeIds: string[]; name: string; description?: string }) => Promise<void>;
}

export function SaveFragmentDialog({ flowName, steps, seedStepIds, editorDirty, onCancel, onCapture }: SaveFragmentDialogProps) {
  const titleId = useId();
  const nameId = useId();
  const descriptionId = useId();
  const { dialogRef } = useModalFocusContract<HTMLDivElement>(onCancel);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(seedStepIds));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const chosen = steps.filter((step) => selected.has(step.id));
  const canSave = !editorDirty && !busy && chosen.length > 0 && name.trim().length > 0;

  const submit = useCallback(async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await onCapture({
        nodeIds: chosen.map((step) => step.id),
        name: name.trim(),
        ...(description.trim() === "" ? {} : { description: description.trim() })
      });
    } finally {
      setBusy(false);
    }
  }, [canSave, chosen, description, name, onCapture]);

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal-dialog fragment-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="fragment-save-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-icon create">
            <Bookmark size={18} aria-hidden="true" />
          </span>
          <h2 id={titleId}>Save selection as fragment</h2>
        </div>

        {editorDirty ? (
          <p className="fragment-blocked-note" role="status" data-testid="fragment-save-dirty">
            <TriangleAlert size={15} aria-hidden="true" />
            <span>
              Save “{flowName}” first. A fragment is captured from the stored flow, so unsaved edits would not be
              included.
            </span>
          </p>
        ) : null}

        <div className="fragment-dialog-body">
          <fieldset className="fragment-step-picker">
            <legend>Steps to include ({chosen.length} of {steps.length})</legend>
            {steps.length === 0 ? (
              <p className="fragment-findings-empty" data-testid="fragment-save-empty">
                This flow has no steps that can go in a fragment yet.
              </p>
            ) : (
              <ul className="fragment-step-list">
                {steps.map((step) => (
                  <li key={step.id}>
                    <label className="fragment-step-option">
                      <input
                        checked={selected.has(step.id)}
                        data-testid={`fragment-step-${step.id}`}
                        onChange={() => toggle(step.id)}
                        type="checkbox"
                      />
                      <span className="fragment-step-name">{step.name}</span>
                      <span className="fragment-step-type">{step.stepType}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          <label className="modal-field" htmlFor={nameId}>
            <span>Fragment name</span>
            <input
              data-testid="fragment-save-name"
              id={nameId}
              onChange={(event) => setName(event.target.value)}
              placeholder="Sign in and dismiss the banner"
              value={name}
            />
          </label>
          <label className="modal-field" htmlFor={descriptionId}>
            <span>Description (optional)</span>
            <input
              data-testid="fragment-save-description"
              id={descriptionId}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </label>
        </div>

        <div className="modal-actions">
          <button className="toolbar-button" data-testid="fragment-save-cancel" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="toolbar-button primary"
            data-testid="fragment-save-confirm"
            disabled={!canSave}
            onClick={() => void submit()}
            type="button"
          >
            {busy ? "Saving…" : "Save fragment"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────────────────────────
 * Insert fragment
 * ──────────────────────────────────────────────────────────────────────────────────────────────── */

export interface InsertFragmentDialogProps {
  /** The flow being edited, so the audit can answer the destination-dependent rules. */
  flowId: string;
  onCancel: () => void;
  onInsert: (fragment: FlowFragment) => void;
  onDelete?: (fragment: FlowFragment) => Promise<void>;
}

export function InsertFragmentDialog({ flowId, onCancel, onInsert, onDelete }: InsertFragmentDialogProps) {
  const titleId = useId();
  const { dialogRef } = useModalFocusContract<HTMLDivElement>(onCancel);
  const [fragments, setFragments] = useState<FlowFragment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [findings, setFindings] = useState<FragmentAuditFinding[] | null>(null);

  /**
   * Every async answer is stamped with the request it belongs to. A slower audit for a
   * previously-selected fragment, or for a flow the user has since left, resolves into a token that
   * no longer matches and is dropped rather than shown against the wrong subject.
   */
  const requestRef = useRef(0);

  const loadList = useCallback(async () => {
    const token = ++requestRef.current;
    try {
      const list = await window.playwrightFlowStudio.fragments.list();
      if (token !== requestRef.current) return;
      setFragments(list);
      setLoadError(null);
    } catch (error) {
      if (token !== requestRef.current) return;
      setFragments([]);
      setLoadError(error instanceof Error ? error.message : "The fragment library could not be read.");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Re-audit whenever the subject changes: a different fragment, or a different destination flow.
  useEffect(() => {
    if (selectedId === null) {
      setFindings(null);
      return;
    }
    const token = ++requestRef.current;
    setFindings(null);
    window.playwrightFlowStudio.fragments
      .audit(selectedId, flowId)
      .then((result) => {
        if (token !== requestRef.current) return;
        setFindings(result);
      })
      .catch(() => {
        if (token !== requestRef.current) return;
        setFindings([
          {
            code: "fragmentShapeInvalid",
            severity: "blocking",
            message: "This fragment could not be audited, so it cannot be inserted."
          }
        ]);
      });
  }, [flowId, selectedId]);

  const selected = useMemo(
    () => fragments?.find((fragment) => fragment.id === selectedId) ?? null,
    [fragments, selectedId]
  );
  const blocked = findings !== null && findings.some((entry) => entry.severity === "blocking");
  const canInsert = selected !== null && findings !== null && !blocked;

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal-dialog fragment-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="fragment-insert-dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-icon create">
            <Blocks size={18} aria-hidden="true" />
          </span>
          <h2 id={titleId}>Insert fragment</h2>
        </div>

        <div className="fragment-dialog-body">
          {fragments === null ? (
            <p className="fragment-findings-empty" data-testid="fragment-insert-loading">
              Loading the fragment library…
            </p>
          ) : loadError !== null ? (
            <p className="fragment-blocked-note" role="alert" data-testid="fragment-insert-error">
              <TriangleAlert size={15} aria-hidden="true" />
              <span>{loadError}</span>
            </p>
          ) : fragments.length === 0 ? (
            <p className="fragment-findings-empty" data-testid="fragment-insert-empty">
              No fragments saved yet. Select steps in a saved flow and use “Save as fragment”.
            </p>
          ) : (
            <ul className="fragment-library" data-testid="fragment-library">
              {fragments.map((fragment) => (
                <li key={fragment.id}>
                  <button
                    aria-pressed={fragment.id === selectedId}
                    className={fragment.id === selectedId ? "fragment-library-row selected" : "fragment-library-row"}
                    data-testid={`fragment-row-${fragment.id}`}
                    onClick={() => setSelectedId(fragment.id)}
                    type="button"
                  >
                    <span className="fragment-library-name">{fragment.name}</span>
                    <span className="fragment-library-meta">
                      {fragment.kind} · {fragment.nodes.length} step{fragment.nodes.length === 1 ? "" : "s"}
                    </span>
                    {fragment.description ? (
                      <span className="fragment-library-description">{fragment.description}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {selected !== null ? (
            <section className="fragment-detail" data-testid="fragment-detail">
              <h3>{selected.name}</h3>
              {selected.inputs.length > 0 ? (
                <div className="fragment-inputs" data-testid="fragment-required-inputs">
                  <span className="fragment-detail-label">Runtime inputs this fragment binds</span>
                  <ul>
                    {selected.inputs.map((input) => (
                      <li key={input.key}>
                        <code>{input.key}</code>
                      </li>
                    ))}
                  </ul>
                  <p className="fragment-inputs-note">
                    The workflow that runs this flow must supply these. They are not rebound on insert, so nothing
                    silently resolves to a different value.
                  </p>
                </div>
              ) : null}
              {findings === null ? (
                <p className="fragment-findings-empty" data-testid="fragment-audit-pending">
                  Checking this fragment against the flow…
                </p>
              ) : (
                <FindingList findings={findings} emptyLabel="No issues — this fragment can be inserted as it is." />
              )}
            </section>
          ) : null}
        </div>

        <div className="modal-actions">
          {selected !== null && onDelete ? (
            <button
              className="toolbar-button"
              data-testid="fragment-delete"
              onClick={() => {
                void onDelete(selected).then(() => {
                  setSelectedId(null);
                  return loadList();
                });
              }}
              type="button"
            >
              Delete
            </button>
          ) : null}
          <button className="toolbar-button" data-testid="fragment-insert-cancel" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="toolbar-button primary"
            data-testid="fragment-insert-confirm"
            disabled={!canInsert}
            onClick={() => {
              if (selected !== null) onInsert(selected);
            }}
            type="button"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
