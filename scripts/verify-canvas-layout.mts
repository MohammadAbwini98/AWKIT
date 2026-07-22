/**
 * Canvas auto-layout verifier (SRS-CANVAS-UX-001 §3.3, FR-3.1 … FR-3.5).
 *
 * Imports the REAL production functions from
 * `app/renderer/components/shared/graphLayout.ts` — the same `positionsNeedLayout` /
 * `layeredLayout` / `withAutoLayout` that `FlowChartDesigner.loadProfile` and the manual
 * "Auto-arrange" action call. Nothing is re-implemented here; if the layout changes, these
 * checks change with it.
 *
 * Why this exists: the layout runs at LOAD time and silently rewrites node coordinates. A
 * regression here does not throw — it produces a readable-looking canvas with nodes sitting on
 * top of each other, or (worse) silently discards a user's hand-placed layout. Neither failure
 * surfaces as an error, so only a geometric assertion catches it.
 *
 * What realistic regression turns this red?
 *   - the stacking guard's dedupe bucket changing, so exact stacks stop being detected;
 *   - clearance constants dropping below FR-3.2's ≥64px / ≥48px legibility floor;
 *   - layering losing input-order stability, making layout non-deterministic between loads;
 *   - the cycle cap being removed (a back-edge would hang the renderer);
 *   - `withAutoLayout` clobbering saved positions on a normal load.
 *
 * Run: npx tsx scripts/verify-canvas-layout.mts
 */
import {
  layeredLayout,
  positionsNeedLayout,
  withAutoLayout,
  type LayoutPosition
} from "../app/renderer/components/shared/graphLayout";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Real designer node dimensions (flowDesignerTypes: DEFAULT_NODE_WIDTH / DEFAULT_NODE_HEIGHT). */
const W = 320;
const H = 96;

interface TestNode {
  id: string;
  position: LayoutPosition;
  data?: { width?: number; height?: number };
}

const node = (id: string, x = 0, y = 0, dims = true): TestNode => ({
  id,
  position: { x, y },
  data: dims ? { width: W, height: H } : undefined
});

/**
 * Node shape for DIRECT `layeredLayout` calls. Note the difference from {@link node}: the layout
 * primitive reads TOP-LEVEL `width`/`height` (`LayoutNodeInput`), whereas React Flow nodes carry
 * them under `data`. `withAutoLayout` is the adapter that maps one to the other. Passing the wrong
 * shape silently falls back to `defaultWidth` and produces overlap — see the pinned check below.
 */
const lnode = (id: string) => ({ id, width: W, height: H });

/** Axis-aligned bounding-box overlap between two laid-out nodes. */
function overlaps(a: LayoutPosition, b: LayoutPosition, w = W, h = H): boolean {
  return a.x < b.x + w && a.x + w > b.x && a.y < b.y + h && a.y + h > b.y;
}

/** Any overlapping pair in a position map; returns the offending pair for the failure message. */
function firstOverlap(pos: Map<string, LayoutPosition>): string | null {
  const entries = [...pos.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      if (overlaps(entries[i][1], entries[j][1])) {
        return `${entries[i][0]}${JSON.stringify(entries[i][1])} ∩ ${entries[j][0]}${JSON.stringify(entries[j][1])}`;
      }
    }
  }
  return null;
}

const json = (v: unknown) => JSON.stringify(v);

// ── FR-3.1 / FR-3.5: when does layout run at all? ────────────────────────────
console.log("\npositionsNeedLayout — the load-time gate:");
{
  const missingAll = [{ position: null }, { position: null }, { position: null }];
  check("all nodes position-less → needs layout", positionsNeedLayout(missingAll) === true);

  const distinct = [{ position: { x: 0, y: 0 } }, { position: { x: 400, y: 0 } }, { position: { x: 0, y: 200 } }];
  check("FR-3.5: distinct saved positions → NO layout (user layout preserved)", positionsNeedLayout(distinct) === false);

  const exactStack = [{ position: { x: 280, y: 120 } }, { position: { x: 280, y: 120 } }];
  check("the {280,120} stacking defect → needs layout", positionsNeedLayout(exactStack) === true);

  const nearStack = [{ position: { x: 280, y: 120 } }, { position: { x: 282, y: 121 } }];
  check("jittered near-stack within one 8px bucket → needs layout", positionsNeedLayout(nearStack) === true);

  // PINNED LIMITATION — the dedupe is a fixed 8px GRID, not a radius. Two nodes 3-4px apart that
  // straddle a bucket boundary hash to different keys and escape detection, even though they
  // visually overlap almost completely. Acceptable today (the real defect is exact stacking on
  // {280,120}), but the module comment's "jittered near-stacks" claim is broader than the code.
  // If this flips to detected, the dedupe became radius-based — update this check and the comment.
  const straddling = [{ position: { x: 280, y: 120 } }, { position: { x: 283, y: 124 } }];
  check("PINNED: near-stack straddling a bucket boundary is NOT detected", positionsNeedLayout(straddling) === false);

  const mixed = [{ position: { x: 0, y: 0 } }, { position: null }, { position: { x: 400, y: 0 } }];
  check("mixed positioned + position-less → needs layout", positionsNeedLayout(mixed) === true);

  check("single position-less node → no layout (documented <2 short-circuit)", positionsNeedLayout([{ position: null }]) === false);
  check("empty graph → no layout", positionsNeedLayout([]) === false);

  // Guard the bucket size: 8px. Two nodes a full node-width apart must NOT read as stacked.
  const apart = [{ position: { x: 0, y: 0 } }, { position: { x: W, y: 0 } }];
  check("nodes a full width apart are not treated as stacked", positionsNeedLayout(apart) === false);
}

// ── FR-3.2 / FR-3.4: geometry ────────────────────────────────────────────────
console.log("\nlayeredLayout — geometry and clearance:");
{
  const nodes = [lnode("a"), lnode("b"), lnode("c")];
  const chain = [{ source: "a", target: "b" }, { source: "b", target: "c" }];
  const pos = layeredLayout(nodes, chain, { direction: "TB" });

  check("every node receives a position", pos.size === 3);
  const [a, b, c] = ["a", "b", "c"].map((id) => pos.get(id)!);
  check("FR-3.4 (TB): successive layers descend", a.y < b.y && b.y < c.y, json([a, b, c]));
  check("FR-3.2: layer clearance ≥48px", b.y - a.y >= H + 48, `gap=${b.y - a.y - H}`);
  check("chain has no overlapping nodes", firstOverlap(pos) === null, firstOverlap(pos) ?? "");

  // Branch: one parent, two children on the same layer — the sibling-clearance case.
  const branchNodes = [lnode("root"), lnode("left"), lnode("right")];
  const branchEdges = [{ source: "root", target: "left" }, { source: "root", target: "right" }];
  const bp = layeredLayout(branchNodes, branchEdges, { direction: "TB" });
  const l = bp.get("left")!;
  const r = bp.get("right")!;
  check("siblings share a layer", l.y === r.y, json([l, r]));
  check("FR-3.2: sibling clearance ≥64px", Math.abs(r.x - l.x) >= W + 64, `gap=${Math.abs(r.x - l.x) - W}`);
  check("branch graph has no overlapping nodes", firstOverlap(bp) === null, firstOverlap(bp) ?? "");

  // LR direction (Workflow Builder default).
  const lr = layeredLayout(branchNodes, branchEdges, { direction: "LR" });
  const lrRoot = lr.get("root")!;
  const lrLeft = lr.get("left")!;
  check("FR-3.4 (LR): layers march rightward", lrLeft.x > lrRoot.x, json([lrRoot, lrLeft]));
  check("LR branch graph has no overlapping nodes", firstOverlap(lr) === null, firstOverlap(lr) ?? "");

  check("empty graph → empty position map", layeredLayout([], [], {}).size === 0);
}

// ── Cycle safety: a back-edge must terminate, not hang the renderer ──────────
console.log("\nlayeredLayout — cycle and self-loop safety:");
{
  const nodes = [lnode("a"), lnode("b")];
  const cyclic = [{ source: "a", target: "b" }, { source: "b", target: "a" }];
  const pos = layeredLayout(nodes, cyclic, { direction: "TB" });
  check("cycle terminates and positions every node", pos.size === 2, json([...pos]));
  check("cycle produces no overlap", firstOverlap(pos) === null, firstOverlap(pos) ?? "");

  // Self-loops route through the node's own port and must not create a layer.
  const selfLoop = [{ source: "a", target: "a" }, { source: "a", target: "b" }];
  const sp = layeredLayout(nodes, selfLoop, { direction: "TB" });
  check("self-loop edge is ignored for layering", sp.get("a")!.y < sp.get("b")!.y, json([...sp]));

  // An edge naming a node that is not in the graph must not throw or mis-layer.
  const dangling = layeredLayout(nodes, [{ source: "a", target: "ghost" }], { direction: "TB" });
  check("edge to an unknown node is ignored", dangling.size === 2);
}

// ── FR-3.5 + determinism: withAutoLayout ─────────────────────────────────────
console.log("\nwithAutoLayout — preservation and determinism:");
{
  const manual = [node("a", 10, 10), node("b", 500, 10), node("c", 10, 400)];
  const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];

  const untouched = withAutoLayout(manual, edges, { direction: "TB" });
  check(
    "FR-3.5: a hand-arranged graph is returned unchanged on load",
    json(untouched.map((n) => n.position)) === json(manual.map((n) => n.position)),
    json(untouched.map((n) => n.position))
  );

  const stacked = [node("a", 280, 120), node("b", 280, 120), node("c", 280, 120)];
  const arranged = withAutoLayout(stacked, edges, { direction: "TB", force: true });
  const arrangedMap = new Map(arranged.map((n) => [n.id, n.position]));
  check("a stacked graph is re-laid out", json(arranged.map((n) => n.position)) !== json(stacked.map((n) => n.position)));
  check("no overlap after re-layout", firstOverlap(arrangedMap) === null, firstOverlap(arrangedMap) ?? "");

  // Determinism: identical input must give byte-identical output, twice.
  const first = withAutoLayout(stacked, edges, { direction: "TB", force: true });
  const second = withAutoLayout(stacked, edges, { direction: "TB", force: true });
  check("layout is deterministic across runs", json(first.map((n) => n.position)) === json(second.map((n) => n.position)));

  // Idempotence: re-running on already-laid-out nodes must not drift.
  const third = withAutoLayout(first, edges, { direction: "TB", force: true });
  check("layout is idempotent (no drift on re-run)", json(third.map((n) => n.position)) === json(first.map((n) => n.position)));

  // Input order stability: the SAME graph declared in a different array order still lays out
  // without overlap (positions may differ; legibility must not).
  const reordered = [node("c", 280, 120), node("a", 280, 120), node("b", 280, 120)];
  const ro = withAutoLayout(reordered, edges, { direction: "TB", force: true });
  check("reordered input still yields no overlap", firstOverlap(new Map(ro.map((n) => [n.id, n.position]))) === null);
}

// ── The real load path: mixed positioned + position-less ─────────────────────
console.log("\nloadProfile simulation — mixed positioned / position-less:");
{
  // FlowChartDesigner.loadProfile seeds missing positions with {280,120}, then calls
  // withAutoLayout(..., { force: true }) when positionsNeedLayout() is true.
  const SEED = { x: 280, y: 120 };
  const saved: { id: string; position?: LayoutPosition }[] = [
    { id: "a", position: { x: 40, y: 40 } },
    { id: "b", position: { x: 600, y: 40 } },
    { id: "c" } // newly added step, never positioned
  ];
  const seeded = saved.map((s) => ({ id: s.id, position: s.position ?? SEED, data: { width: W, height: H } }));
  const edges = [{ source: "a", target: "b" }, { source: "b", target: "c" }];

  check("mixed graph trips the layout gate", positionsNeedLayout(saved.map((s) => ({ position: s.position ?? null }))) === true);

  const loaded = withAutoLayout(seeded, edges, { direction: "TB", force: true });
  const loadedMap = new Map(loaded.map((n) => [n.id, n.position]));
  check("no node overlaps another after load", firstOverlap(loadedMap) === null, firstOverlap(loadedMap) ?? "");
  check("the position-less node no longer sits on the seed coordinate", json(loadedMap.get("c")) !== json(SEED), json(loadedMap.get("c")));

  // PINNED BEHAVIOUR — read before "fixing" a failure here.
  // loadProfile passes `force: true`, so ONE position-less node causes EVERY node to be
  // re-positioned: 'a' and 'b' lose their hand-placed coordinates. That is the current,
  // deliberate behaviour (a partially-positioned graph has no sane partial layout), but it is in
  // tension with "preserve all valid user-saved positions". If this check fails, the load path
  // changed to a preserving layout — update this check and SRS FR-3.5 together.
  const aMoved = json(loadedMap.get("a")) !== json({ x: 40, y: 40 });
  const bMoved = json(loadedMap.get("b")) !== json({ x: 600, y: 40 });
  check("PINNED: force:true re-positions ALL nodes, incl. hand-placed ones", aMoved && bMoved, `a moved=${aMoved} b moved=${bMoved}`);
}

// ── Dimension fallback guard ─────────────────────────────────────────────────
console.log("\nDimension handling:");
{
  const edges = [{ source: "a", target: "b" }];
  // Nodes WITH real dimensions must be spaced for those dimensions.
  const sized = layeredLayout([{ id: "a", width: W, height: H }, { id: "b", width: W, height: H }], edges, { direction: "TB" });
  check("sized nodes are spaced for their real height", sized.get("b")!.y - sized.get("a")!.y >= H, json([...sized]));

  // PINNED: graphLayout's internal defaultWidth (220) is NARROWER than the designer's real
  // DEFAULT_NODE_WIDTH (320). Both the create and load paths populate data.width, so this
  // fallback is currently unreachable — but if a caller ever omits dimensions, siblings would be
  // spaced 220+64=284 apart while rendering 320 wide, i.e. a 36px overlap. Guard the assumption.
  const unsized = layeredLayout([{ id: "a" }, { id: "b" }], [], { direction: "TB" });
  const gap = Math.abs(unsized.get("b")!.x - unsized.get("a")!.x);
  check("PINNED: dimension-less siblings would under-space vs real 320px nodes", gap < W + 64, `gap=${gap}, real node width=${W}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
