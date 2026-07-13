/**
 * Identity-preserving map for canvas node/edge derivation.
 *
 * The designers derive a display array from `nodes`/`edges` (adding render-only flags like
 * `isLeaf`/`hasLoop` and interaction callbacks). A plain `.map(...)` allocates a fresh object
 * for EVERY item on any change, so editing one node hands `<FlowCanvas>` all-new node refs and
 * the memoized `NodeContainer`/card re-renders the whole graph.
 *
 * `mapWithIdentity` keeps a per-id cache and reuses the previously-built output object whenever
 * the source item (by reference) and its derived `signature` are both unchanged — so downstream
 * `React.memo` skips untouched items and only the edited node re-renders. Removed ids are pruned
 * each pass, so the cache never grows past the current item count. When shared inputs baked into
 * every output change (e.g. the interaction callbacks), pass them as `version` to rebuild all
 * entries once and avoid stale closures.
 */
export interface IdentityStore<S, D> {
  map: Map<string, { source: S; sig: string; out: D }>;
  version: unknown;
}

export function createIdentityStore<S, D>(): IdentityStore<S, D> {
  return { map: new Map(), version: undefined };
}

function versionsEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

export function mapWithIdentity<S extends { id: string }, D>(
  store: IdentityStore<S, D>,
  items: readonly S[],
  version: unknown,
  signature: (item: S) => string,
  build: (item: S) => D
): D[] {
  if (!versionsEqual(store.version, version)) {
    store.version = version;
    store.map = new Map();
  }
  const next = new Map<string, { source: S; sig: string; out: D }>();
  const result = items.map((item) => {
    const sig = signature(item);
    const prev = store.map.get(item.id);
    if (prev && prev.source === item && prev.sig === sig) {
      next.set(item.id, prev);
      return prev.out;
    }
    const out = build(item);
    next.set(item.id, { source: item, sig, out });
    return out;
  });
  store.map = next;
  return result;
}
