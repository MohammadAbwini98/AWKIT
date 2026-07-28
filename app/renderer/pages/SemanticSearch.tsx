import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";

import { Permission } from "@src/security/authz/Permissions";
import { SEMANTIC_MAX_QUERY_LENGTH } from "@src/semantic/contracts/SemanticApi";
import type { SemanticDocumentKind } from "@src/semantic/contracts/SemanticDocument";

import { usePermissions } from "../security/usePermissions";
import { SemanticResultList } from "../semantic/SemanticResultList";
// Renderer-safe kind list — SemanticDocument.ts imports node:crypto, so its values cannot be
// bundled into the renderer (see semanticMessages.ts).
import { SEMANTIC_KIND_OPTIONS, semanticKindLabel } from "../semantic/semanticMessages";
import { useSemanticQuery, type SemanticQueryMode } from "../semantic/useSemanticQuery";

interface ModeOption {
  id: SemanticQueryMode;
  label: string;
  hint: string;
  /** Extra permission this mode needs beyond `SEMANTIC_SEARCH`, when it needs one. */
  requires?: Permission;
}

const MODES: ModeOption[] = [
  {
    id: "search",
    label: "Search",
    hint: "Find flows, workflows and nodes similar to a phrase."
  },
  {
    id: "similarFailures",
    label: "Similar failures",
    hint: "Find past runs that failed in a comparable way.",
    requires: Permission.SEMANTIC_VIEW_FAILURE_SIMILARITY
  },
  {
    id: "suggestLocators",
    label: "Locator suggestions",
    hint: "Which locator strategies have worked before in this scope."
  }
];

/**
 * Semantic Search — the user-facing entry point to the index.
 *
 * All three query kinds share one results surface, so a user learns one way to read a result. The
 * page holds no IPC call of its own: `useSemanticQuery` owns that, which is what lets later beads
 * embed a focused search into the Libraries, Reports and Designers without duplicating the logic.
 *
 * The route is gated on `SEMANTIC_SEARCH`, so a Viewer never reaches it. The extra gate below is for
 * `similarFailures`, which an Operator may hold while a lesser role does not — the mode is hidden
 * rather than the page, because the rest of the page is still usable.
 */
export function SemanticSearch() {
  const { can } = usePermissions();
  const { hits, degraded, error, loading, ran, settings, run, reset } = useSemanticQuery();

  const modes = MODES.filter((mode) => !mode.requires || can(mode.requires));
  const [mode, setMode] = useState<SemanticQueryMode>("search");
  const [text, setText] = useState("");
  const [kinds, setKinds] = useState<SemanticDocumentKind[]>([]);
  const [topK, setTopK] = useState<number | null>(null);

  const active = modes.find((m) => m.id === mode) ?? modes[0];
  // `suggestLocators` is a scope query — it is meaningful with no text at all.
  const canSubmit = !loading && (active.id === "suggestLocators" || text.trim().length > 0);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    void run({
      mode: active.id,
      text,
      kinds: active.id === "search" && kinds.length > 0 ? kinds : undefined,
      topK: topK ?? undefined
    });
  };

  const toggleKind = (kind: SemanticDocumentKind) => {
    setKinds((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]));
  };

  return (
    <section className="page">
      {/* Matches the Flows / Settings convention: route label as h1, a status span beside it. */}
      <div className="section-heading">
        <h1>Semantic Search</h1>
        <span>{ran && !error ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : "Searches your flows, runs and locator memory"}</span>
      </div>

      <section className="work-panel settings-card">
        <div className="settings-card-head">
          <Search size={16} />
          <h2>Query the index</h2>
        </div>

        <div className="semantic-mode-row" role="group" aria-label="Query kind">
          {modes.map((option) => (
            <button
              aria-pressed={option.id === active.id}
              className={option.id === active.id ? "toolbar-button primary" : "toolbar-button"}
              key={option.id}
              type="button"
              onClick={() => {
                setMode(option.id);
                reset();
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="settings-card-hint">{active.hint}</p>

        <form className="semantic-query-form" onSubmit={submit}>
          <label className="semantic-query-field">
            <span>Query</span>
            <input
              maxLength={SEMANTIC_MAX_QUERY_LENGTH}
              placeholder={active.id === "suggestLocators" ? "Optional — describe the element" : "Describe what you're looking for"}
              type="search"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
            />
          </label>
          <label className="semantic-query-field semantic-query-topk">
            <span>Results</span>
            <input
              max={settings?.maxTopK ?? undefined}
              min={1}
              placeholder={String(settings?.defaultTopK ?? "")}
              type="number"
              value={topK ?? ""}
              onChange={(ev) => setTopK(ev.target.value === "" ? null : Number(ev.target.value))}
            />
          </label>
          <button className="toolbar-button primary" disabled={!canSubmit} type="submit">
            <Search size={15} />
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {active.id === "search" ? (
          <fieldset className="semantic-kind-filter">
            <legend>Limit to kinds (optional)</legend>
            {SEMANTIC_KIND_OPTIONS.map((kind) => (
              <label key={kind}>
                <input checked={kinds.includes(kind)} type="checkbox" onChange={() => toggleKind(kind)} />
                <span>{semanticKindLabel(kind)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </section>

      <section className="work-panel settings-card">
        <div className="settings-card-head">
          <h2>Results{ran && !error ? ` (${hits.length})` : ""}</h2>
        </div>
        <SemanticResultList degraded={degraded} error={error} hits={hits} loading={loading} ran={ran} />
      </section>
    </section>
  );
}
