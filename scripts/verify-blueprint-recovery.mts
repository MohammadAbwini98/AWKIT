// Verifies the Locator Blueprint recovery feature's Node-side surfaces (docs/implementation_plan.md):
// blueprint ASSEMBLY (buildRecordedFlow → PageBlueprint/ElementBlueprint), page-key + document
// fingerprint normalization, the additive `blueprintId` reference, and the durable file store
// (atomic put/get/list + size guard). It reuses the EXACT hashFingerprint()/hashToken() pipeline so
// there is no second hashing model.
//
// COVERAGE BOUNDARY (be honest): this verifier does NOT exercise the in-page capture
// (`recorderInitScript.captureBlueprint`, browser-only) nor the runtime resolution fast-path
// (`LocatorFactory.recoverLocally`, real-page only) — both need a live Chromium page and belong in a
// companion `verify:blueprint-recovery-browser` gate. What regression makes THIS file fail: any change
// that stops persisting a blueprintId, leaks raw label/attribute/URL text into a blueprint, diverges
// the fingerprint hashing, breaks page-key stripping/normalization, drops the 2000-element cap, or
// breaks the atomic store round-trip / size guard.
//
// Run: npm run verify:blueprint-recovery
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRecordedFlow } from "@src/recorder/buildRecordedFlow";
import type { RecordedAction, RecordedActionLocator } from "@src/recorder/RecorderTypes";
import type { LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import {
  computeDocumentFingerprint,
  computeFrameKey,
  computePageKey,
  documentFingerprintMatches,
  documentFingerprintSimilarity,
  FileLocatorBlueprintStore,
  MAX_BLUEPRINT_FILE_SIZE,
  type ElementBlueprint,
  type PageBlueprint
} from "@src/runner/LocatorBlueprintStore";
import { hashFingerprint, hashToken, similarity } from "@src/runner/locatorFingerprint";

const results: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

// Distinctive PII-like tokens so the privacy assertions cannot pass vacuously: none of these may
// survive into a persisted blueprint (name/text/attribute values and URL query must be hashed/stripped).
const PII_LABEL = "SecretUserFullName";
const PII_ATTR_VALUE = "secret-order-9931";
const PII_QUERY_TOKEN = "authtoken-7742";

function rawFp(over: Partial<LocatorElementFingerprint> = {}): LocatorElementFingerprint {
  return {
    tag: "input",
    role: "textbox",
    name: PII_LABEL,
    text: PII_LABEL,
    attributes: { id: "order-field", "data-testid": PII_ATTR_VALUE },
    ancestry: ["form|main", "div", "section"],
    ...over
  };
}

interface CaptureOver {
  url?: string;
  title?: string;
  documentOrder?: number;
  siblingIndex?: number;
  sameTagIndex?: number;
  fingerprint?: LocatorElementFingerprint;
  documentStructure?: string;
  alternatives?: number;
  frameChain?: Array<{ selector: string; index?: number; name?: string; title?: string; url?: string }>;
}

function capturingClick(id: string, o: CaptureOver = {}): RecordedAction {
  const fp = o.fingerprint ?? rawFp();
  const locator: RecordedActionLocator = {
    strategy: "role",
    value: "textbox",
    name: "Field",
    blueprintCapture: {
      documentOrder: o.documentOrder ?? 12,
      siblingIndex: o.siblingIndex ?? 3,
      sameTagIndex: o.sameTagIndex ?? 1,
      visible: true,
      enabled: true,
      boundingRegion: { relativeX: 0.1, relativeY: 0.2, relativeWidth: 0.3, relativeHeight: 0.04 },
      fingerprint: { ...fp },
      url: o.url ?? `https://shop.example.com/checkout?session=${PII_QUERY_TOKEN}#frag`,
      title: o.title ?? "Checkout - Acme Store",
      documentStructure: o.documentStructure ?? "div=5|form=1|input=1"
    }
  };
  if (o.alternatives) {
    locator.alternatives = Array.from({ length: o.alternatives }, (_unused, i) => ({ strategy: "css", value: `.alt-${i}` }));
  }
  if (o.frameChain) locator.context = { frameChain: o.frameChain };
  return { id, type: "click", name: "Click Field", locator };
}

// ── 1. Capture → assembly wiring ─────────────────────────────────────────────
const bps1: PageBlueprint[] = [];
const fp1 = rawFp();
const flow1 = buildRecordedFlow("BP", [capturingClick("a1", { fingerprint: fp1, documentOrder: 12, alternatives: 2 })], bps1);
const bp1 = bps1[0];
const step1 = flow1.nodes.find((n) => n.id === "step-1");
const el1: ElementBlueprint | undefined = bp1?.elements[0];

check("single capturing action yields exactly one page blueprint", bps1.length === 1);
check("blueprint holds exactly one element", bp1?.elements.length === 1);
check("step receives a non-empty blueprintId", typeof step1?.locator?.blueprintId === "string" && step1!.locator!.blueprintId!.length > 0);
check("blueprintId links the step to the stored element", !!el1 && el1.blueprintId === step1?.locator?.blueprintId);
check("positional evidence preserved (documentOrder/siblingIndex/sameTagIndex)", el1?.documentOrder === 12 && el1?.siblingIndex === 3 && el1?.sameTagIndex === 1);
check("capture state preserved (visible/enabled/boundingRegion)", el1?.visible === true && el1?.enabled === true && el1?.boundingRegion?.relativeWidth === 0.3);
check("tag/role derived from the captured fingerprint", el1?.tag === "input" && el1?.role === "textbox");
check("alternativeCount reflects the recorded alternatives", el1?.alternativeCount === 2);
check("documentFingerprint is the captured structure histogram", bp1?.documentFingerprint === "div=5|form=1|input=1");
check("primaryLocatorDigest is a hashed digest of the primary locator", el1?.primaryLocatorDigest === hashToken(JSON.stringify({ strategy: "role", value: "textbox" })));

// ── 2. Hashing parity & privacy ──────────────────────────────────────────────
check("stored fingerprint equals hashFingerprint(raw) — one shared pipeline, no divergence", eq(el1?.fingerprint, hashFingerprint(fp1)));
check("stored fingerprint is HASHED, not the raw fingerprint", !eq(el1?.fingerprint, fp1));
check("hashed-fingerprint ancestry entries are 20-hex hashes", (el1?.fingerprint.ancestry.length ?? 0) === 3 && !!el1?.fingerprint.ancestry.every((a) => /^[0-9a-f]{20}$/.test(a)));
check("top-level ancestry reuses the HASHED fingerprint ancestry", eq(el1?.ancestry, el1?.fingerprint.ancestry));
const serialized1 = JSON.stringify(bp1);
check("raw label/text token is NOT persisted (hashed away)", !serialized1.includes(PII_LABEL));
check("raw attribute VALUE is NOT persisted (hashed away)", !serialized1.includes(PII_ATTR_VALUE));
check("URL query token is NOT persisted (canonicalUrl is origin+pathname only)", !serialized1.includes(PII_QUERY_TOKEN));
check("canonicalUrl is origin + pathname only", bp1?.canonicalUrl === "https://shop.example.com/checkout");

// ── 2b. Adaptive hashed-fingerprint scoring ──────────────────────────────────
// Scrapling's useful relocation idea is broad structural comparison rather than selector replay.
// AWKIT keeps its own privacy-hashed schema and strict LocatorFactory threshold/margin, but a benign
// wrapper insertion should retain ordered ancestry evidence instead of losing every shifted index.
const stableRaw = rawFp({
  attributes: { id: "checkout-field", "data-testid": "checkout-field" },
  ancestry: ["form|checkout", "section|main", "main"]
});
const wrapperShiftRaw = rawFp({
  attributes: { id: "checkout-field-v2", "data-testid": "checkout-field" },
  ancestry: ["div|wrapper", "form|checkout", "section|main"]
});
const structurallyDifferentRaw = rawFp({
  name: "Different account control",
  text: "Different account control",
  attributes: { name: "other-control" },
  ancestry: ["aside|secondary", "nav", "body"]
});
const stableHashed = hashFingerprint(stableRaw);
const wrapperShiftHashed = hashFingerprint(wrapperShiftRaw);
const structurallyDifferentHashed = hashFingerprint(structurallyDifferentRaw);
const wrapperShiftScore = similarity(stableHashed, wrapperShiftHashed);
const structurallyDifferentScore = similarity(stableHashed, structurallyDifferentHashed);
check(
  "adaptive similarity retains ordered ancestry through one inserted wrapper",
  wrapperShiftScore >= 0.86,
  wrapperShiftScore.toFixed(6)
);
check(
  "adaptive similarity gives partial attribute credit without treating a changed id as exact",
  wrapperShiftScore < 1,
  wrapperShiftScore.toFixed(6)
);
check(
  "materially different identity stays below the production recovery threshold",
  structurallyDifferentScore < 0.86,
  structurallyDifferentScore.toFixed(6)
);
check(
  "adaptive scorer remains symmetric for hashed fingerprints",
  similarity(stableHashed, wrapperShiftHashed) === similarity(wrapperShiftHashed, stableHashed)
);

// ── 3. computePageKey normalization ──────────────────────────────────────────
const kBase = computePageKey("https://a.example.com/orders", "Orders - Acme Store");
check("computePageKey is deterministic", kBase === computePageKey("https://a.example.com/orders", "Orders - Acme Store"));
check("query/fragment ignored (same origin+pathname → same key)", kBase === computePageKey("https://a.example.com/orders?page=2&x=1#frag", "Orders - Acme Store"));
check("different pathname → different key", kBase !== computePageKey("https://a.example.com/customers", "Orders - Acme Store"));
check("title words beyond the first three do NOT change the key", kBase === computePageKey("https://a.example.com/orders", "Orders - Acme Store — Q3 Region West"));
check("different title category (first 3 words) → different key", kBase !== computePageKey("https://a.example.com/orders", "Customers - Acme Store"));
check("frame flag changes the key", kBase !== computePageKey("https://a.example.com/orders", "Orders - Acme Store", "frame"));
check("page key is a 64-char sha-256 hex", /^[0-9a-f]{64}$/.test(kBase));

// ── 4. computeDocumentFingerprint ────────────────────────────────────────────
const dfA = computeDocumentFingerprint([{ tag: "div" }, { tag: "button", role: "button" }, { tag: "div" }]);
const dfB = computeDocumentFingerprint([{ tag: "button", role: "button" }, { tag: "div" }, { tag: "div" }]);
check("document fingerprint is order-independent (same multiset → same hash)", dfA === dfB);
check("different element histogram → different fingerprint", dfA !== computeDocumentFingerprint([{ tag: "div" }, { tag: "span" }]));
check("role participates in the histogram key", computeDocumentFingerprint([{ tag: "div", role: "button" }]) !== computeDocumentFingerprint([{ tag: "div" }]));
check("document fingerprint is a 20-hex digest", /^[0-9a-f]{20}$/.test(dfA));
check("document variant gate tolerates one inserted element", documentFingerprintMatches("button=1|div=205", "aside=1|button=1|div=205"));
check("document variant gate rejects a materially different same-URL page", !documentFingerprintMatches("button=1|div=205", "a=205|button=1"));
check("document variant similarity is deterministic", documentFingerprintSimilarity("button=1|div=205", "aside=1|button=1|div=205") === 206 / 207);

// ── 4b. Frame identity parity ───────────────────────────────────────────────
const frameChain = [
  { selector: "iframe#outer", title: "Checkout shell", url: "https://host.example.com/frame" },
  { selector: "iframe#inner", index: 1, name: "payment" }
];
const frameKey = computeFrameKey(frameChain);
const framedBlueprints: PageBlueprint[] = [];
const framedFlow = buildRecordedFlow(
  "Framed",
  [capturingClick("framed", { url: "https://pay.example.com/form?token=hidden", title: "Payment Form", frameChain })],
  framedBlueprints
);
check("frame-chain digest is deterministic and privacy-safe", /^[0-9a-f]{20}$/.test(frameKey) && frameKey === computeFrameKey(frameChain));
check("frame blueprint stores the real frame-chain digest", framedBlueprints[0]?.frameKey === frameKey);
check("framed step and element stay linked", framedBlueprints[0]?.elements[0]?.blueprintId === framedFlow.nodes.find((node) => node.id === "step-1")?.locator?.blueprintId);
check("element frameChainDigest matches the page frameKey", framedBlueprints[0]?.elements[0]?.frameChainDigest === frameKey);
check("framed pageKey uses child URL/title + frame digest", framedBlueprints[0]?.pageKey === computePageKey("https://pay.example.com/form", "Payment Form", frameKey));
check("changing the frame chain changes its key", frameKey !== computeFrameKey([{ selector: "iframe#other" }]));

// ── 5. Dedupe by page key / multi-page ───────────────────────────────────────
const bps2: PageBlueprint[] = [];
buildRecordedFlow(
  "Multi",
  [
    capturingClick("a1", { url: "https://x.example.com/p1", title: "Page One" }),
    capturingClick("a2", { url: "https://x.example.com/p1?z=1", title: "Page One" }), // same page (query differs)
    capturingClick("a3", { url: "https://x.example.com/p2", title: "Page Two" }) // different page
  ],
  bps2
);
const p1Key = computePageKey("https://x.example.com/p1", "Page One");
const sharedBp = bps2.find((b) => b.pageKey === p1Key);
check("distinct pages produce distinct blueprints", bps2.length === 2);
check("actions on the same page share ONE blueprint that accumulates BOTH elements", sharedBp?.elements.length === 2);

// ── 6. Legacy / additive safety ──────────────────────────────────────────────
const legacyFlow = buildRecordedFlow("Legacy", [capturingClick("a1")]); // no blueprintsOut arg
check("no blueprintId assigned when blueprintsOut is absent (legacy path unaffected)", legacyFlow.nodes.every((n) => !n.locator || n.locator.blueprintId === undefined));
const bps3: PageBlueprint[] = [];
const plainAction: RecordedAction = { id: "n1", type: "click", name: "Plain click", locator: { strategy: "role", value: "button", name: "X" } };
const flow3 = buildRecordedFlow("NoCap", [plainAction], bps3);
check("an action without blueprintCapture creates no blueprint", bps3.length === 0);
check("an action without blueprintCapture receives no blueprintId", flow3.nodes.find((n) => n.id === "step-1")?.locator?.blueprintId === undefined);

// ── 7. blueprintId survives serialization ────────────────────────────────────
const roundTripped = JSON.parse(JSON.stringify(flow1)) as typeof flow1;
check("blueprintId survives a flow JSON serialize/deserialize round trip", roundTripped.nodes.find((n) => n.id === "step-1")?.locator?.blueprintId === step1?.locator?.blueprintId);

// ── 8. 2000-element cap (capture permissively, cap strictly) ──────────────────
const manyActions: RecordedAction[] = Array.from({ length: 2100 }, (_unused, i) => capturingClick(`m${i}`, { url: "https://cap.example.com/big", title: "Big Page" }));
const bps4: PageBlueprint[] = [];
const bigFlow = buildRecordedFlow("Cap", manyActions, bps4);
check("blueprint element count is capped at 2000", bps4[0]?.elements.length === 2000);
check("only the first 2000 steps receive a blueprintId (cap enforced on the step too)", bigFlow.nodes.filter((n) => n.locator?.blueprintId).length === 2000);

// ── 9. Durable file store (real fs: atomic put/get/list + guards) ─────────────
const dir = await mkdtemp(join(tmpdir(), "awkit-bp-"));
try {
  const store = new FileLocatorBlueprintStore(dir);
  await store.put(bp1);
  check("store put → get round-trips the blueprint exactly", eq(await store.get(bp1.pageKey), bp1));
  check("store.get returns undefined for an unknown page key", (await store.get("no-such-page-key")) === undefined);
  check("store.list includes the persisted blueprint", (await store.list()).some((b) => b.pageKey === bp1.pageKey));
  check("atomic write leaves no .tmp files behind", (await readdir(dir)).every((n) => !n.endsWith(".tmp")));

  // A file with the wrong schemaVersion must be rejected, not returned as a blueprint.
  const digest = createHash("sha256").update(bp1.pageKey).digest("hex");
  await writeFile(join(dir, `${digest}.json`), JSON.stringify({ ...bp1, schemaVersion: 2 }), "utf8");
  check("store.get rejects a schema-version-mismatched file", (await store.get(bp1.pageKey)) === undefined);

  // Over-size guard: a blueprint whose serialization exceeds the byte cap must be refused.
  const huge: PageBlueprint = {
    ...bp1,
    pageKey: "oversized-key",
    elements: Array.from({ length: 3000 }, (_unused, i) => ({ ...bp1.elements[0], blueprintId: `oversized-${i}` }))
  };
  let threw = false;
  try {
    await store.put(huge);
  } catch {
    threw = true;
  }
  check(`store.put rejects a blueprint larger than ${Math.round(MAX_BLUEPRINT_FILE_SIZE / 1024)}KB`, threw);
} finally {
  await rm(dir, { recursive: true, force: true });
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} blueprint-recovery checks passed`);
process.exit(passed === results.length ? 0 : 1);