import { useCallback, useEffect, useRef, useState } from "react";

import {
  SEMANTIC_MAX_QUERY_LENGTH,
  type SemanticReasonCode,
  type SemanticSearchResponse,
  type SemanticSettingsView
} from "@src/semantic/contracts/SemanticApi";
import type { SemanticDocumentKind, SemanticSearchHit } from "@src/semantic/contracts/SemanticDocument";

import { semanticReasonMessage } from "./semanticMessages";

const api = () => window.playwrightFlowStudio.semantic;

/** The three query kinds, behind one call shape so a caller picks a mode rather than a channel. */
export type SemanticQueryMode = "search" | "similarFailures" | "suggestLocators";

export interface SemanticQueryInput {
  mode: SemanticQueryMode;
  text: string;
  kinds?: SemanticDocumentKind[];
  workflowId?: string;
  flowId?: string;
  nodeType?: string;
  errorCategory?: string;
  excludeRunId?: string;
  topK?: number;
}

export interface SemanticQueryState {
  hits: SemanticSearchHit[];
  /** The backend answered from a degraded mode — results are real but may be incomplete. */
  degraded: boolean;
  /** Null until a query has run. `"OK"` with zero hits is a successful empty result, not an error. */
  code: SemanticReasonCode | null;
  /** Present only when `code` is not `"OK"`; already turned into a user-facing sentence. */
  error: string | null;
  loading: boolean;
  /** True once a query has completed, so the UI can tell "no results" from "nothing asked yet". */
  ran: boolean;
}

const EMPTY: SemanticQueryState = { hits: [], degraded: false, code: null, error: null, loading: false, ran: false };

/**
 * The single place any renderer surface talks to the semantic index.
 *
 * Later beads embed focused entry points in the Libraries, Reports and the Designers; they call this
 * hook rather than `window.playwrightFlowStudio.semantic` directly, so bounding, the empty/degraded
 * distinction and reason-code messaging exist once.
 *
 * Bounding is applied here as well as in the main process. That is not redundant defence — the main
 * process is the enforcement point — it is so the UI can show a bounded value in its own controls
 * instead of silently having a request trimmed underneath it.
 */
export function useSemanticQuery() {
  const [state, setState] = useState<SemanticQueryState>(EMPTY);
  const [settings, setSettings] = useState<SemanticSettingsView | null>(null);
  /** Guards against an out-of-order response overwriting a newer one. */
  const runId = useRef(0);

  useEffect(() => {
    let alive = true;
    void api()
      .getSettings()
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch(() => {
        // A settings read failure must not block searching: `topK` simply falls back to the
        // contract default, which the main process would have applied anyway.
        if (alive) setSettings(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const reset = useCallback(() => {
    runId.current += 1;
    setState(EMPTY);
  }, []);

  const run = useCallback(
    async (input: SemanticQueryInput): Promise<void> => {
      const id = runId.current + 1;
      runId.current = id;

      const text = input.text.trim().slice(0, SEMANTIC_MAX_QUERY_LENGTH);
      const topK = settings ? Math.min(input.topK ?? settings.defaultTopK, settings.maxTopK) : input.topK;

      setState((prev) => ({ ...prev, loading: true, error: null }));

      let response: SemanticSearchResponse;
      try {
        switch (input.mode) {
          case "search":
            response = await api().search({
              text,
              topK,
              kinds: input.kinds,
              workflowId: input.workflowId,
              flowId: input.flowId,
              nodeType: input.nodeType,
              errorCategory: input.errorCategory
            });
            break;
          case "similarFailures":
            response = await api().similarFailures({
              text,
              topK,
              workflowId: input.workflowId,
              errorCategory: input.errorCategory,
              excludeRunId: input.excludeRunId
            });
            break;
          case "suggestLocators":
            response = await api().suggestLocators({
              text: text.length > 0 ? text : undefined,
              topK,
              workflowId: input.workflowId,
              flowId: input.flowId,
              nodeType: input.nodeType
            });
            break;
          default: {
            const unhandled: never = input.mode;
            throw new Error(`Unhandled semantic query mode: ${String(unhandled)}`);
          }
        }
      } catch {
        // A rejected invoke here means a denied READ channel (those still throw) or a genuine
        // fault. Either way there is no reason code to switch on, so it is reported as a failed
        // search rather than guessed at.
        if (runId.current === id) {
          setState({ hits: [], degraded: false, code: "SEARCH_FAILED", error: semanticReasonMessage("SEARCH_FAILED"), loading: false, ran: true });
        }
        return;
      }

      if (runId.current !== id) return; // superseded by a newer query

      setState({
        hits: response.hits,
        degraded: response.degraded,
        code: response.code,
        error: response.code === "OK" ? null : semanticReasonMessage(response.code, response.message),
        loading: false,
        ran: true
      });
    },
    [settings]
  );

  return { ...state, settings, run, reset };
}
