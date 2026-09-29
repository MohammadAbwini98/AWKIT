import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RotateCcw, Timer } from "lucide-react";

import type { AiBudgetView, AiSettingsView } from "@src/ai/contracts/AiApi";

import { ReauthDialog } from "./admin/ReauthDialog";
import { useSensitiveSemanticAction, type SensitiveAdminResponse } from "../semantic/useSensitiveSemanticAction";

const api = () => window.playwrightFlowStudio.ai;

function describe(response: SensitiveAdminResponse): string {
  if (response.message) return response.message;
  return response.code === "NOT_AUTHORIZED" ? "You don't have permission to do that." : "That action could not be completed.";
}

/** The configured budgets as the patch carries them: the map replaces the stored one. */
function configuredMap(budgets: readonly AiBudgetView[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const budget of budgets) if (budget.configured) map[budget.id] = budget.seconds;
  return map;
}

function BudgetRow({ budget, busy, onSave }: { budget: AiBudgetView; busy: boolean; onSave: (id: string, seconds: number | null, onError: (message: string | null) => void) => void }) {
  const saved = String(budget.seconds);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  // A refused entry stays visible beside its error; a saved value replaces it.
  useEffect(() => setDraft(saved), [saved]);
  const field = `ai-budget-${budget.id}`;

  const commit = (input: HTMLInputElement): void => {
    if (busy) return;
    // Only an unparseable entry is decided here; the bounds are main's rule, and its refusal is shown as is.
    const value = input.validity.badInput || input.value.trim() === "" ? Number.NaN : Number(input.value);
    if (value === budget.seconds) {
      setError(null);
      return;
    }
    onSave(budget.id, value, setError);
  };

  return (
    <tr>
      <td>
        <label htmlFor={field}>{budget.label}</label>
      </td>
      <td>
        <input
          aria-describedby={`${field}-bounds${error ? ` ${field}-error` : ""}`}
          aria-invalid={error ? true : undefined}
          className="ai-budget-input"
          id={field}
          inputMode="numeric"
          max={budget.maxSeconds}
          min={budget.minSeconds}
          step={1}
          type="number"
          value={draft}
          onBlur={(ev) => commit(ev.currentTarget)}
          onChange={(ev) => setDraft(ev.currentTarget.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") commit(ev.currentTarget);
          }}
        />
        {error ? (
          <p className="form-message error" id={`${field}-error`} role="alert">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {error}
          </p>
        ) : null}
      </td>
      <td id={`${field}-bounds`}>
        {budget.minSeconds}–{budget.maxSeconds} s; default {budget.defaultSeconds} s
      </td>
      <td className="sys-td-actions">
        {budget.configured ? (
          <button className="toolbar-button" disabled={busy} type="button" onClick={() => onSave(budget.id, null, setError)}>
            <RotateCcw size={15} aria-hidden="true" />
            Use default
          </button>
        ) : (
          "Default"
        )}
      </td>
    </tr>
  );
}

/**
 * Settings → Local AI → Time limits (Phase L, L9.2, E8).
 *
 * One bounded time limit per kind of AI work, written through `ai:updateSettings` (`ai.manage`, re-auth).
 * Main owns every rule: a value outside the committed bounds is refused with main's own sentence, never
 * clamped. A limit is not an estimate: estimates come from measured runs. A changed limit makes the
 * features under it read unqualified, because their evidence was measured under the default.
 */
export function LocalAiTimeBudgets({ settings, sessionRef, onChanged }: { settings: AiSettingsView; sessionRef: string; onChanged: () => Promise<void> }) {
  const action = useSensitiveSemanticAction(describe);

  const save = (id: string, seconds: number | null, onError: (message: string | null) => void): void => {
    const timeBudgetSeconds = configuredMap(settings.budgets);
    if (seconds === null) delete timeBudgetSeconds[id];
    else timeBudgetSeconds[id] = seconds;
    const label = settings.budgets.find((budget) => budget.id === id)?.label ?? id;
    void action
      .run(async () => {
        const response = await api().updateSettings({ timeBudgetSeconds } as Parameters<ReturnType<typeof api>["updateSettings"]>[0]);
        onError(response.ok || response.code === "REAUTH_REQUIRED" ? null : describe(response));
        return response;
      }, seconds === null ? `${label} time limit back to its default.` : `${label} time limit set to ${seconds} s.`)
      .then(onChanged);
  };

  return (
    <section className="settings-subsection" aria-labelledby="ai-budgets-title">
      <div className="settings-card-head">
        <Timer size={16} aria-hidden="true" />
        <h3 id="ai-budgets-title">Time limits</h3>
      </div>
      <p className="settings-card-hint">
        How long each kind of AI work may run before it is stopped. A limit is not an estimate: progress estimates come
        from runs measured on this machine. Changing a feature&apos;s limit makes it read unqualified until it is measured
        again under the new limit, because its quality evidence was measured under the default.
      </p>
      {action.notice ? (
        <p className="form-message" role="status">
          <CheckCircle2 size={13} style={{ verticalAlign: "-2px" }} /> {action.notice}
        </p>
      ) : null}
      <div className="sys-table-scroll">
        <table className="sys-table" aria-label="Local AI time limits">
          <thead>
            <tr>
              <th scope="col" className="sys-th"><span className="sys-th-button">Work</span></th>
              <th scope="col" className="sys-th"><span className="sys-th-button">Limit (seconds)</span></th>
              <th scope="col" className="sys-th"><span className="sys-th-button">Allowed</span></th>
              <th scope="col" className="sys-th"><span className="sys-th-button">Source</span></th>
            </tr>
          </thead>
          <tbody>
            {settings.budgets.map((budget) => (
              <BudgetRow budget={budget} busy={action.busy} key={budget.id} onSave={save} />
            ))}
          </tbody>
        </table>
      </div>
      {action.needsReauth ? (
        <ReauthDialog sessionRef={sessionRef} onCancel={action.onReauthCancelled} onConfirmed={action.onReauthConfirmed} />
      ) : null}
    </section>
  );
}
