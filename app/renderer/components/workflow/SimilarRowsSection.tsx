import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Rows3 } from "lucide-react";

import { similarRowsCsv, type DomSimilarRowsResponse } from "@src/runner/domIntelligence/DomIntelligenceApi";
import { Permission } from "@src/security/authz/Permissions";

import { usePermissions } from "../../security/usePermissions";

/**
 * L12.13 "Find similar rows" (awkit-djnl.21.13): in the Element Spy, the inspected element and every element
 * alike to it on the live page, as redacted text, with a CSV copy. Read-only: nothing on the page changes.
 */
export function SimilarRowsSection({ inspectedAt, testId = "similar-rows" }: { inspectedAt: string | null; testId?: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DomSimilarRowsResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const { can } = usePermissions();
  const token = useRef(0);

  useEffect(() => {
    token.current += 1;
    setResult(null);
    setBusy(false);
    setCopied(false);
  }, [inspectedAt]);

  if (!can(Permission.PAGE_RECORDER) || !can(Permission.RECORDER_ELEMENT_SPY)) return null;

  const run = async (): Promise<void> => {
    const mine = (token.current += 1);
    setBusy(true);
    setCopied(false);
    let response: DomSimilarRowsResponse;
    try {
      response = await window.playwrightFlowStudio.domIntelligence.similarRows();
    } catch {
      response = { ok: false, code: "FAILED", message: "Similar elements could not be found on this page." };
    }
    if (mine !== token.current) return;
    setBusy(false);
    setResult(response);
  };

  const copy = async (rows: string[]): Promise<void> => {
    try {
      await navigator.clipboard.writeText(similarRowsCsv(rows));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="locator-status" data-testid={testId}>
      <div className="locator-status-head">
        <button className="toolbar-button" type="button" data-testid={`${testId}-run`} disabled={!inspectedAt || busy} onClick={() => void run()}>
          <Rows3 size={15} aria-hidden="true" />
          {busy ? "Finding similar rows…" : "Find similar rows"}
        </button>
        {result?.ok && result.rows.length > 0 ? (
          <button className="toolbar-button" type="button" data-testid={`${testId}-copy`} onClick={() => void copy(result.rows)}>
            {copied ? "Copied as CSV" : "Copy as CSV"}
          </button>
        ) : null}
      </div>
      <div role="status" aria-live="polite" data-testid={`${testId}-result`}>
        {result && !result.ok ? (
          <span className="form-message error">
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} aria-hidden="true" /> {result.message}
          </span>
        ) : null}
        {result?.ok ? (
          <>
            <span className="locator-status-headline" data-testid={`${testId}-summary`} data-rows={result.rows.length}>
              {result.total <= 1
                ? "No other element on this page looks like this one."
                : `${result.total} elements look like this one${result.total > result.rows.length ? `; the first ${result.rows.length} are shown` : ""}. Nothing was changed.`}
            </span>
            <ol className="locator-evidence-list" aria-label="Similar rows">
              {result.rows.map((row, index) => (
                <li key={index} className="locator-evidence-row">
                  {row || "(no visible text)"}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </div>
    </div>
  );
}
