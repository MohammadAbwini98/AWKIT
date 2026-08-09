import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { RoadmapSnapshot } from "../../main/roadmapSnapshotService";
// The standalone dashboard owns these framework-free view renderers and icon nodes. Reusing them is
// intentional: embedded and standalone cards/tables/derivations cannot drift into separate products.
// @ts-expect-error shared developer-tool JavaScript has no TypeScript declaration file
import { VIEWS } from "../../../tools/roadmap/public/views.js";
// @ts-expect-error shared developer-tool JavaScript has no TypeScript declaration file
import { icon as roadmapIcon } from "../../../tools/roadmap/public/icons.js";
import "../../../tools/roadmap/public/dashboard.css";

type RoadmapView = {
  id: string;
  label: string;
  icon: string;
  title: string;
  subtitle: (snapshot: RoadmapSnapshot) => string;
  count: (snapshot: RoadmapSnapshot) => number | null;
  render: (context: Record<string, unknown>) => Node;
};

const views = VIEWS as RoadmapView[];

function RoadmapIcon({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    ref.current?.replaceChildren(roadmapIcon(name, 16));
  }, [name]);
  return <span className="rm-icon" ref={ref} aria-hidden="true" />;
}
export function ImplementationRoadmap() {
  const [snapshot, setSnapshot] = useState<RoadmapSnapshot | null>(null);
  const [viewId, setViewId] = useState("overview");
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const disposersRef = useRef<Array<() => void>>([]);
  const currentView = useMemo(() => views.find((view) => view.id === viewId) ?? views[0], [viewId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await window.playwrightFlowStudio.roadmap.getSnapshot());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the Program Status snapshot.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const host = bodyRef.current;
    if (!host || !snapshot) return;
    for (const dispose of disposersRef.current) dispose();
    disposersRef.current = [];
    const mounters: Array<() => void> = [];
    const byId = new Map((snapshot.items as Array<{ id: string }>).map((item) => [item.id, item]));
    const rerender = () => {
      // View-local filters are held by the shared registry; a shallow snapshot update asks React to
      // run this effect again without duplicating derivation logic in the renderer.
      setSnapshot((current) => (current ? { ...current } : current));
    };
    const node = currentView.render({
      snap: snapshot,
      items: snapshot.items,
      byId,
      filter,
      navigate: setViewId,
      setFilter,
      rerender,
      onDispose: (dispose: () => void) => disposersRef.current.push(dispose),
      onMount: (mount: () => void) => mounters.push(mount)
    });
    const stack = document.createElement("div");
    stack.className = "rm-stack rm-view-enter";
    stack.appendChild(node);
    host.replaceChildren(stack);
    host.scrollTop = 0;
    for (const mount of mounters) mount();
    return () => {
      for (const dispose of disposersRef.current) dispose();
      disposersRef.current = [];
    };
  }, [snapshot, currentView, filter]);

  return (
    <section className="page rm-embedded-page" data-testid="embedded-roadmap">
      <div className="rm-embedded-layout">
        <div className="rm-embedded-main">
          <header className="rm-header rm-embedded-header">
            <div className="rm-header-title">
              <h1>{currentView.title}</h1>
              <p>{snapshot ? currentView.subtitle(snapshot) : "Reading the repository snapshot…"}</p>
            </div>
            <div className="rm-header-actions">
              <label className="rm-search" htmlFor="embedded-roadmap-filter">
                <Search size={15} aria-hidden="true" />
                <input
                  id="embedded-roadmap-filter"
                  type="search"
                  value={filter}
                  placeholder="Filter by title, id or area…"
                  onChange={(event) => setFilter(event.target.value.trimStart())}
                />
              </label>
              <button className="rm-button" type="button" onClick={() => void load()} disabled={loading}>
                <RefreshCw size={14} aria-hidden="true" />
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </header>
          {error ? <div className="settings-banner error" role="alert">{error}</div> : null}
          <div className="rm-page rm-embedded-view" ref={bodyRef} tabIndex={-1} />
          {snapshot ? (
            <footer className="rm-status-bar">
              {`${snapshot.sources.length} sources · ${snapshot.stats.items} records · ${snapshot.warnings.length} warnings`}
            </footer>
          ) : null}
        </div>
        <nav className="rm-embedded-nav" aria-label="Program Status views" data-testid="roadmap-section-nav">
          <div className="rm-embedded-nav-heading">
            <span>Program Status</span>
            <strong>Repository views</strong>
          </div>
          <div className="rm-embedded-nav-list">
            {views.map((view) => {
              const count = snapshot ? view.count(snapshot) : null;
              return (
                <button
                  className={`nav-item${view.id === currentView.id ? " active" : ""}`}
                  type="button"
                  key={view.id}
                  aria-current={view.id === currentView.id ? "page" : undefined}
                  onClick={() => setViewId(view.id)}
                >
                  <RoadmapIcon name={view.icon} />
                  <span>{view.label}</span>
                  {count === null ? null : <span className="rm-nav-count">{count}</span>}
                </button>
              );
            })}
          </div>
          <p className="rm-live" data-state={error ? "offline" : "live"}>
            <span className="rm-live-dot" aria-hidden="true" />
            <span>{error ? "Unavailable" : "Embedded · read-only"}</span>
          </p>
        </nav>
      </div>
    </section>
  );
}
