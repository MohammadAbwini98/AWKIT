import { AlertTriangle, Search } from "lucide-react";

import type { SemanticSearchHit } from "@src/semantic/contracts/SemanticDocument";

import { semanticKindLabel } from "./semanticMessages";

interface SemanticResultListProps {
  hits: SemanticSearchHit[];
  /** True once a query has completed — distinguishes "no matches" from "nothing asked yet". */
  ran: boolean;
  loading: boolean;
  degraded: boolean;
  /** Already a user-facing sentence; the raw reason code never reaches this component. */
  error: string | null;
}

/**
 * The shared results surface for every semantic query kind.
 *
 * **Every hit shows its `reasons`.** `SemanticDocument.ts` makes explainability contractual — the
 * subsystem "never surfaces an opaque score as certainty" — so a hit rendered as a bare relevance
 * number would break that contract in the one place the user actually sees it. The score is shown
 * too, but never alone.
 */
export function SemanticResultList({ hits, ran, loading, degraded, error }: SemanticResultListProps) {
  if (loading) {
    return <p className="form-message">Searching…</p>;
  }

  if (error) {
    return (
      <p className="form-message error" role="alert">
        <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {error}
      </p>
    );
  }

  if (!ran) {
    return (
      <div className="empty-state">
        <strong>
          <Search size={15} style={{ verticalAlign: "-2px" }} /> Nothing searched yet
        </strong>
        <span>Enter a phrase above to search the semantic index.</span>
      </div>
    );
  }

  if (hits.length === 0) {
    // A successful query with no matches. Deliberately worded so it cannot be mistaken for a
    // failure or for an index that has not been built — those are separate, and carry their own
    // reason codes.
    return (
      <div className="empty-state">
        <strong>No matches</strong>
        <span>The index was searched successfully and contained nothing similar to that query.</span>
      </div>
    );
  }

  return (
    <>
      {degraded ? (
        <p className="form-message" role="status">
          <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> These results came from a degraded index, so
          they may be incomplete. A rebuild from Settings → Semantic Index will restore full coverage.
        </p>
      ) : null}
      <ul className="semantic-hit-list">
        {hits.map((hit) => (
          <li className="semantic-hit" key={hit.documentId}>
            <div className="semantic-hit-head">
              <span className="semantic-hit-kind">{semanticKindLabel(hit.kind)}</span>
              <strong className="semantic-hit-title">{hit.title}</strong>
              <span className="semantic-hit-score" title="Relevance score">
                {hit.score.toFixed(2)}
              </span>
            </div>
            {hit.summary ? <p className="semantic-hit-summary">{hit.summary}</p> : null}
            {hit.reasons.length > 0 ? (
              <ul className="semantic-hit-reasons">
                {hit.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            <div className="semantic-hit-meta">
              {hit.workflowId ? <span>Workflow {hit.workflowId}</span> : null}
              {hit.flowId ? <span>Flow {hit.flowId}</span> : null}
              {hit.hostname ? <span>{hit.hostname}</span> : null}
              <span>Updated {new Date(hit.updatedAt).toLocaleString()}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
