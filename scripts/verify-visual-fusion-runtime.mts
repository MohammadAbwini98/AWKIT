/**
 * verify:visual-fusion-runtime — Phase N2 runtime: the runner-owned visual reference store (N2.4b, awkit-vra.12.4b).
 *
 * No browser. Every case runs the real `VisualReferenceStore` against a fresh temporary folder:
 *   - round trip, and a record never answers for another `scopeKey` (mutation contract item 7);
 *   - corruption never throws and reads as missing/corrupt (fusion R1): truncated JSON, garbage, null, an array, a
 *     foreign record copied to another step's file, a wrong record version, a digest that does not match the evidence,
 *     evidence of the wrong inner version, and an oversized file;
 *   - another evidence version reads as `version-mismatch` (fusion R2), never as found;
 *   - writes are bounded: oversized or digest-less evidence is refused and nothing is written;
 *   - rate limiting: at most one write per `refreshMs`, and only when the content digest changed;
 *   - atomic replacement: transient EPERM/EBUSY renames are retried, a persistent or non-transient failure is reported
 *     (not thrown), the previous record is untouched and no temp file is left;
 *   - concurrent instances on one folder: distinct steps never cross, one step from two instances writes once, a burst
 *     of writes to one step leaves a whole record and no temp files;
 *   - the refresh table stays bounded, and an unwritable folder fails without throwing.
 *
 * Run: npm run verify:visual-fusion-runtime
 */

import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";
import {
  VISUAL_REFERENCE_REFRESH_ENTRIES,
  VisualReferenceStore,
  visualReferenceRefreshEntries,
  type VisualReferenceStoreOptions
} from "@src/runner/visualFusion/VisualReferenceStore";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROOT = await mkdtemp(join(tmpdir(), "awkit-visual-references-"));
let folders = 0;
const freshFolder = (): string => join(ROOT, `store-${++folders}`);
const fileFor = (folder: string, scopeKey: string): string => join(folder, `${createHash("sha256").update(scopeKey).digest("hex")}.json`);

function evidence(seed: string, extra: Partial<VisualEvidence> = {}): VisualEvidence {
  return {
    version: VISUAL_EVIDENCE_VERSION,
    kind: "element",
    capturedAt: "2026-10-13T00:00:00.000Z",
    viewport: { cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1 },
    frame: { depth: 0 },
    bounds: {
      requested: { x: 10, y: 20, width: 120, height: 32 },
      actual: { x: 10, y: 20, width: 120, height: 32 },
      actualCss: { x: 10, y: 20, width: 120, height: 32 },
      wasClipped: false
    },
    fingerprint: {
      version: 1,
      contentDigest: `sha256:${createHash("sha256").update(seed).digest("hex")}`,
      width: 120,
      height: 32
    },
    ...extra
  } as unknown as VisualEvidence;
}

const digestOf = (value: unknown): string | null => (value as VisualEvidence | null)?.fingerprint?.contentDigest ?? null;

function store(folder: string, extra: Partial<VisualReferenceStoreOptions> = {}): VisualReferenceStore {
  return new VisualReferenceStore({
    folder,
    evidenceVersion: VISUAL_EVIDENCE_VERSION,
    maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES,
    digestOf,
    ...extra
  });
}

/** A clock the cases advance by hand. */
function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start;
  return { now: () => at, advance: (ms) => (at += ms) };
}

const tempFiles = async (folder: string): Promise<string[]> => (await readdir(folder).catch(() => [] as string[])).filter((n) => n.endsWith(".tmp"));

try {
  console.log("\nRound trip and scope binding:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    check("an unknown step reads as missing", (await s.get("scenario:a|step:1")).status === "missing");
    const written = await s.refresh("scenario:a|step:1", evidence("one"));
    check("a first refresh writes", written.status === "written", JSON.stringify(written));
    const read = await s.get("scenario:a|step:1");
    check(
      "the record reads back as found, evidence and digest intact",
      read.status === "found" && JSON.stringify(read.evidence) === JSON.stringify(evidence("one")) && read.contentDigest === digestOf(evidence("one")),
      JSON.stringify(read).slice(0, 200)
    );
    check("another step does not read this step's record", (await s.get("scenario:a|step:2")).status === "missing");
    await s.refresh("scenario:a|step:2", evidence("two"));
    const second = await s.get("scenario:a|step:2");
    const first = await s.get("scenario:a|step:1");
    check(
      "two steps keep their own evidence",
      second.status === "found" && first.status === "found" && second.contentDigest !== first.contentDigest && second.contentDigest === digestOf(evidence("two"))
    );
    // Mutation contract item 7: a record placed under another step's file name must not answer for that step.
    await writeFile(fileFor(folder, "scenario:a|step:3"), await readFile(fileFor(folder, "scenario:a|step:1"), "utf8"), "utf8");
    check("a record copied under another step's name reads as corrupt, never as found", (await s.get("scenario:a|step:3")).status === "corrupt");
    const stored = await readFile(fileFor(folder, "scenario:a|step:1"), "utf8");
    check(
      "the stored file is bounded and carries no image data",
      stored.length <= VISUAL_EVIDENCE_MAX_BYTES + 2048 && !/data:image|base64|"image"|"bytes"/.test(stored),
      `${stored.length} bytes`
    );
  }

  console.log("\nCorruption reads as R1 and never throws:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    await s.refresh("k", evidence("base"));
    const valid = JSON.parse(await readFile(fileFor(folder, "k"), "utf8")) as Record<string, unknown>;
    const cases: Array<[string, string, string]> = [
      ["truncated JSON", JSON.stringify(valid).slice(0, 40), "corrupt"],
      ["garbage bytes", "\u0000\u0001not json at all", "corrupt"],
      ["empty file", "", "corrupt"],
      ["JSON null", "null", "corrupt"],
      ["a JSON array", "[1,2,3]", "corrupt"],
      ["a wrong record version", JSON.stringify({ ...valid, version: 2 }), "corrupt"],
      ["a malformed digest", JSON.stringify({ ...valid, contentDigest: "md5:abc" }), "corrupt"],
      ["a digest that does not match the evidence", JSON.stringify({ ...valid, contentDigest: digestOf(evidence("other")) }), "corrupt"],
      ["evidence of a different inner version", JSON.stringify({ ...valid, evidence: { ...(valid.evidence as object), version: 99 } }), "corrupt"],
      ["no evidence", JSON.stringify({ ...valid, evidence: null }), "corrupt"],
      ["a missing timestamp", JSON.stringify({ ...valid, updatedAt: undefined }), "corrupt"],
      ["an oversized file", JSON.stringify({ ...valid, pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES + 4096) }), "corrupt"],
      [
        "oversized evidence inside a small-enough envelope",
        JSON.stringify({ ...valid, evidence: { ...(valid.evidence as object), pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES - 200) } }),
        "corrupt"
      ],
      ["another evidence version", JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1 }), "version-mismatch"],
      [
        "a self-consistent record of another evidence version",
        JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1, evidence: { ...(valid.evidence as object), version: VISUAL_EVIDENCE_VERSION + 1 } }),
        "version-mismatch"
      ]
    ];
    let threw = 0;
    for (const [label, text, want] of cases) {
      await writeFile(fileFor(folder, "k"), text, "utf8");
      try {
        const read = await s.get("k");
        check(`${label} reads as ${want}`, read.status === want, read.status);
      } catch (error) {
        threw += 1;
        check(`${label} reads as ${want}`, false, `threw ${String(error)}`);
      }
    }
    check("the corruption table is non-vacuous", cases.length >= 14, String(cases.length));
    check("no corrupt record threw", threw === 0, String(threw));
    await writeFile(fileFor(folder, "k"), JSON.stringify({ ...valid, evidenceVersion: VISUAL_EVIDENCE_VERSION + 1 }), "utf8");
    const mismatch = await s.get("k");
    check("a version mismatch names the stored version", mismatch.status === "version-mismatch" && mismatch.evidenceVersion === VISUAL_EVIDENCE_VERSION + 1);
    await writeFile(fileFor(folder, "k"), "{", "utf8");
    const t = clock(5_000_000);
    const healed = await store(folder, { now: t.now }).refresh("k", evidence("healed"));
    const after = await s.get("k");
    check("a corrupt record is replaced by the next refresh", healed.status === "written" && after.status === "found" && after.contentDigest === digestOf(evidence("healed")));
  }

  console.log("\nWrites are bounded and validated:\n");
  {
    const folder = freshFolder();
    const s = store(folder, { now: clock().now });
    const oversized = await s.refresh("big", evidence("big", { pad: "x".repeat(VISUAL_EVIDENCE_MAX_BYTES) } as Partial<VisualEvidence>));
    check("oversized evidence is refused", oversized.status === "refused" && oversized.reason === "oversized", JSON.stringify(oversized));
    check("nothing is written for refused evidence", (await s.get("big")).status === "missing");
    const noDigest = await s.refresh("nodigest", { ...evidence("x"), fingerprint: { version: 1 } });
    check("evidence without a content digest is refused", noDigest.status === "refused" && noDigest.reason === "invalid", JSON.stringify(noDigest));
    const wrongVersion = await s.refresh("wrongversion", { ...evidence("x"), version: VISUAL_EVIDENCE_VERSION + 1 });
    check("evidence of another version is refused", wrongVersion.status === "refused" && wrongVersion.reason === "invalid", JSON.stringify(wrongVersion));
    for (const bad of [null, undefined, "evidence", 42]) {
      const result = await s.refresh("bad", bad);
      check(`non-object evidence (${String(bad)}) is refused`, result.status === "refused", JSON.stringify(result));
    }
    const throwing = store(folder, { now: clock().now, digestOf: () => { throw new Error("boom"); } });
    const thrown = await throwing.refresh("throwing", evidence("t"));
    check("a throwing digest reader refuses instead of throwing", thrown.status === "refused", JSON.stringify(thrown));
    check("refusals never touch the rate limit", s.dueForRefresh("big") && s.dueForRefresh("nodigest"));
  }

  console.log("\nRate limiting and digest change:\n");
  {
    const folder = freshFolder();
    const t = clock();
    const s = store(folder, { now: t.now, refreshMs: 60_000 });
    check("a fresh step is due", s.dueForRefresh("loop"));
    check("the first refresh writes", (await s.refresh("loop", evidence("v1"))).status === "written");
    check("the step is not due right after a write", !s.dueForRefresh("loop"));
    t.advance(59_999);
    const early = await s.refresh("loop", evidence("v2"));
    check("a changed reference inside the interval is rate-limited", early.status === "rate-limited", JSON.stringify(early));
    const kept = await s.get("loop");
    check("the rate-limited write left the old reference", kept.status === "found" && kept.contentDigest === digestOf(evidence("v1")));
    t.advance(1);
    check("the step is due again at exactly the interval", s.dueForRefresh("loop"));
    const same = await s.refresh("loop", evidence("v1"));
    check("an unchanged digest after the interval is not rewritten", same.status === "unchanged", JSON.stringify(same));
    t.advance(60_000);
    const changed = await s.refresh("loop", evidence("v2"));
    const now = await s.get("loop");
    check("a changed digest after the interval is written", changed.status === "written" && now.status === "found" && now.contentDigest === digestOf(evidence("v2")));
  }

  console.log("\nAtomic replacement with bounded EPERM/EBUSY retry:\n");
  {
    const folder = freshFolder();
    const t = clock();
    let attempts = 0;
    const retries: string[] = [];
    const flaky = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        sleep: async () => undefined,
        onRetry: (_attempt, code) => retries.push(code),
        renameImpl: async (from, to) => {
          attempts += 1;
          if (attempts <= 2) throw Object.assign(new Error("held by a scanner"), { code: attempts === 1 ? "EPERM" : "EBUSY" });
          await rename(from, to);
        }
      }
    });
    const written = await flaky.refresh("retry", evidence("retry"));
    check("transient EPERM then EBUSY renames are retried and the write lands", written.status === "written" && attempts === 3, `${JSON.stringify(written)} after ${attempts}`);
    check("both transient codes were retried", retries.join(",") === "EPERM,EBUSY", retries.join(","));
    check("the retried record reads back", (await flaky.get("retry")).status === "found");

    let permanentAttempts = 0;
    const stuck = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        attempts: 4,
        sleep: async () => undefined,
        renameImpl: async () => {
          permanentAttempts += 1;
          throw Object.assign(new Error("locked"), { code: "EPERM" });
        }
      }
    });
    const before = await readFile(fileFor(folder, "retry"), "utf8").catch(() => null);
    const failedWrite = await stuck.refresh("retry", evidence("never"));
    check("a persistent EPERM is reported, not thrown", failedWrite.status === "failed" && failedWrite.code === "EPERM", JSON.stringify(failedWrite));
    check("a persistent EPERM is retried a bounded number of times", permanentAttempts === 4, String(permanentAttempts));
    check("the previous record is untouched", before !== null && (await readFile(fileFor(folder, "retry"), "utf8").catch(() => null)) === before);
    check("no temp file is left behind", (await tempFiles(folder)).length === 0, (await tempFiles(folder)).join(", "));

    let accessAttempts = 0;
    const denied = store(folder, {
      now: t.now,
      refreshMs: 0,
      replace: {
        sleep: async () => undefined,
        renameImpl: async () => {
          accessAttempts += 1;
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }
      }
    });
    const deniedWrite = await denied.refresh("retry", evidence("denied"));
    check("a non-transient failure is not retried", deniedWrite.status === "failed" && deniedWrite.code === "EACCES" && accessAttempts === 1, `${JSON.stringify(deniedWrite)} after ${accessAttempts}`);
    check("still no temp file", (await tempFiles(folder)).length === 0);
  }

  console.log("\nConcurrent instances on one folder:\n");
  {
    const folder = freshFolder();
    const t = clock();
    const a = store(folder, { now: t.now });
    const b = store(folder, { now: t.now });
    const steps = Array.from({ length: 12 }, (_, i) => `scenario:c|step:${i}`);
    const results = await Promise.all(steps.map((key, i) => (i % 2 ? a : b).refresh(key, evidence(key))));
    check("distinct steps written from two instances all land", results.every((r) => r.status === "written"), JSON.stringify(results.map((r) => r.status)));
    const reads = await Promise.all(steps.map((key, i) => (i % 2 ? b : a).get(key)));
    check(
      "each step reads back its own evidence from the other instance",
      reads.every((r, i) => r.status === "found" && r.contentDigest === digestOf(evidence(steps[i])))
    );

    const race = await Promise.all([a.refresh("shared", evidence("from-a")), b.refresh("shared", evidence("from-b"))]);
    const statuses = race.map((r) => r.status).sort();
    check("one step refreshed by two instances at once writes exactly once", JSON.stringify(statuses) === JSON.stringify(["rate-limited", "written"]), JSON.stringify(statuses));
    const winner = await a.get("shared");
    check(
      "the shared record is the writer's whole evidence",
      winner.status === "found" && winner.contentDigest === digestOf(evidence(race[0].status === "written" ? "from-a" : "from-b"))
    );

    const burstA = store(folder, { now: t.now, refreshMs: 0 });
    const burstB = store(folder, { now: t.now, refreshMs: 0 });
    const burst = await Promise.all(Array.from({ length: 24 }, (_, i) => (i % 2 ? burstA : burstB).refresh("burst", evidence(`burst-${i}`))));
    check("a burst of 24 writes to one step never throws or fails", burst.every((r) => r.status === "written" || r.status === "unchanged"), JSON.stringify(burst.map((r) => r.status)));
    const last = await burstA.get("burst");
    const candidates = new Set(Array.from({ length: 24 }, (_, i) => digestOf(evidence(`burst-${i}`))));
    check("the burst leaves one whole record of one writer", last.status === "found" && candidates.has(last.contentDigest));
    check("the burst leaves no temp file", (await tempFiles(folder)).length === 0);
  }

  console.log("\nBounded refresh table and unwritable storage:\n");
  {
    const blocker = join(ROOT, "not-a-folder");
    await writeFile(blocker, "a file where the folder should be", "utf8");
    const t = clock();
    const s = store(join(blocker, "visual-references"), { now: t.now });
    const first = await s.refresh("unwritable", evidence("u"));
    check("an unwritable folder fails without throwing", first.status === "failed", JSON.stringify(first));
    check("an unreadable record location reads as missing or corrupt", ["missing", "corrupt"].includes((await s.get("unwritable")).status));
    const extra = 64;
    for (let i = 0; i < VISUAL_REFERENCE_REFRESH_ENTRIES + extra; i++) await s.refresh(`bound-${i}`, evidence("b"));
    check(
      "the refresh table never exceeds its cap",
      visualReferenceRefreshEntries() <= VISUAL_REFERENCE_REFRESH_ENTRIES && visualReferenceRefreshEntries() >= VISUAL_REFERENCE_REFRESH_ENTRIES - 1,
      String(visualReferenceRefreshEntries())
    );
    check("the oldest step was forgotten first and is due again", s.dueForRefresh("bound-0") && !s.dueForRefresh(`bound-${VISUAL_REFERENCE_REFRESH_ENTRIES + extra - 1}`));
  }
} finally {
  await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
}

check("the suite is non-vacuous", passed >= 60, String(passed));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
