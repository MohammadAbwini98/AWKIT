// Durability checks for the JSON profile store (src/storage/ProfileStore.ts) that persists the
// user's flows / workflows / data sources / reports. No Electron — pure fs semantics in a temp dir.
//
// Guards audit findings A1 (non-atomic write), A2 (silent corrupt-file drop), A3 (non-atomic
// id-rename update), and S1 (concurrent-save race).
//
// Run: npx tsx scripts/verify-profile-store.mts
import { mkdtemp, readdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonProfileStore } from "../src/storage/ProfileStore";

interface Doc {
  id: string;
  name: string;
  payload: string;
}

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const tmpFiles = async (folder: string) => (await readdir(folder)).filter((f) => f.endsWith(".tmp"));
const jsonFiles = async (folder: string) => (await readdir(folder)).filter((f) => f.endsWith(".json"));

async function main() {
  // 1. Atomic write + concurrent creates: 40 profiles written in parallel all persist, no temp residue.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-1-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => store.create({ id: `doc-${i}`, name: `Doc ${i}`, payload: "x".repeat(200) }))
    );
    const listed = await store.list();
    const leftoverTmp = await tmpFiles(folder);
    check("40 concurrent creates all persist", listed.length === 40, `count=${listed.length}`);
    check("no leftover .tmp files after writes (A1)", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    // Every persisted file is complete, valid JSON (atomic write never truncates).
    let allValid = true;
    for (const f of await jsonFiles(folder)) {
      try {
        JSON.parse(await readFile(join(folder, f), "utf8"));
      } catch {
        allValid = false;
      }
    }
    check("every persisted file is complete valid JSON (A1)", allValid);
    await rm(folder, { recursive: true, force: true });
  }

  // 2. Concurrent updates to the SAME id serialize cleanly: final state is one valid record, no residue.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-2-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "hot", name: "v0", payload: "" });
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => store.update("hot", { id: "hot", name: `v${i + 1}`, payload: `p${i + 1}` }))
    );
    const final = await store.get("hot");
    const leftoverTmp = await tmpFiles(folder);
    const listed = await store.list();
    check("40 concurrent updates leave exactly one record (S1)", listed.length === 1, `count=${listed.length}`);
    check("final record is readable/valid after concurrent writes (S1)", !!final && final.id === "hot", `final=${final?.name}`);
    check("no leftover .tmp files after concurrent updates (A1/S1)", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    await rm(folder, { recursive: true, force: true });
  }

  // 3. Corrupt file is quarantined, not silently dropped (A2).
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-3-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "good", name: "Good", payload: "ok" });
    await writeFile(join(folder, "broken.json"), "{ this is : not json ", "utf8");
    const listed = await store.list();
    const entries = await readdir(folder);
    const quarantined = entries.filter((f) => f.includes(".corrupt-"));
    check("corrupt file is excluded from list() (A2)", listed.length === 1 && listed[0].id === "good", `count=${listed.length}`);
    check("corrupt file is quarantined to a .corrupt-* sibling, not lost (A2)", quarantined.length === 1, `quarantined=${quarantined}`);
    check("original broken.json no longer present after quarantine (A2)", !entries.includes("broken.json"));
    // The quarantined bytes are preserved verbatim.
    const preserved = await readFile(join(folder, quarantined[0]), "utf8");
    check("quarantined bytes preserved for recovery (A2)", preserved === "{ this is : not json ");
    await rm(folder, { recursive: true, force: true });
  }

  // 4. id-rename update writes-new-before-deleting-old and never loses the record (A3).
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-4-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "old-id", name: "Renamed", payload: "keepme" });
    await store.update("old-id", { id: "new-id", name: "Renamed", payload: "keepme" });
    const byNew = await store.get("new-id");
    const byOld = await store.get("old-id");
    check("renamed record is retrievable under the new id (A3)", byNew?.payload === "keepme", `payload=${byNew?.payload}`);
    check("old id no longer resolves after rename (A3)", byOld === null);
    const listed = await store.list();
    check("exactly one record remains after id rename (A3)", listed.length === 1, `count=${listed.length}`);
    await rm(folder, { recursive: true, force: true });
  }

  // 5. Draft model (Stage 2b): the store persists a validation-INVALID but parseable flow verbatim.
  // Validation informs (engine/UI layers); persistence never gates on it and never mutates the
  // document — a saved draft is byte-for-byte what the caller supplied.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-5-"));
    const store = new JsonProfileStore<Record<string, unknown> & { id: string }>({ folder });
    // Missing Start/End, a broken connector endpoint, a negative timeout — invalid by every
    // engine rule, but a perfectly parseable document.
    const invalidFlow = {
      id: "draft-invalid",
      name: "Draft",
      version: 1,
      nodes: [{ id: "n1", type: "click", name: "Click", timeoutMs: -5 }],
      edges: [{ id: "e1", source: "n1", target: "ghost", type: "success" }]
    };
    const imported = await store.import(structuredClone(invalidFlow));
    check("an invalid-but-parseable flow imports as a draft (Stage 2b)", imported.id === "draft-invalid");
    const readBack = await store.get("draft-invalid");
    check(
      "the stored draft is exactly what was supplied — nothing auto-fixed or removed",
      JSON.stringify(readBack) === JSON.stringify(invalidFlow)
    );
    const updated = await store.update("draft-invalid", structuredClone(invalidFlow));
    check("re-saving the invalid draft succeeds and stays unchanged", JSON.stringify(updated) === JSON.stringify(invalidFlow));
    await rm(folder, { recursive: true, force: true });
  }

  // 6. Schema evolution: approval metadata and unknown future fields remain byte-for-byte intact.
  // JsonProfileStore is deliberately field-agnostic; narrowing this path would silently strip
  // evidence during save/reload even though the FlowProfile schema remains backward-compatible.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-6-"));
    const store = new JsonProfileStore<Record<string, unknown> & { id: string }>({ folder });
    const flow = {
      id: "approval-round-trip",
      name: "Approval round trip",
      version: 1,
      futureProfileField: { retained: true },
      nodes: [{
        id: "choose-second",
        type: "click",
        name: "Choose second twin",
        futureStepField: ["keep", "me"],
        locator: {
          strategy: "css",
          value: ".pos-btn:nth-of-type(2)",
          context: {
            frame: { selector: "iframe#catalog" },
            shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-host" }] }
          },
          resolution: "user-approved-fallback",
          resolvedBy: "user",
          approvedFallbackReason: "Reviewed: position is intentional in this fixture.",
          approvedFallbackBinding: {
            version: 1,
            stepType: "click",
            stepName: "Choose second twin",
            locator: { strategy: "css", value: ".pos-btn:nth-of-type(2)" },
            context: {
              frame: { selector: "iframe#catalog" },
              shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-host" }] }
            },
            futureBindingField: "preserve-fail-closed"
          },
          futureLocatorEvidence: { recorder: "next-version" }
        }
      }],
      edges: []
    };
    await store.create(structuredClone(flow));
    const readBack = await store.get(flow.id);
    check("approval binding + unknown future fields survive profile-store create/get", JSON.stringify(readBack) === JSON.stringify(flow));
    const updated = await store.update(flow.id, structuredClone(flow));
    check("approval binding + unknown future fields survive profile-store update", JSON.stringify(updated) === JSON.stringify(flow));
    await rm(folder, { recursive: true, force: true });
  }

  {
    /*
     * Transient rename failures must not lose a save.
     *
     * A single unretried `rename` here cost a real save: soaking the Workflow capsule suite
     * reproduced "EPERM: operation not permitted, rename '<...>.tmp' -> '<...>.json'" about one run
     * in four, with the edited workflow on screen and Save enabled. The renderer showed a
     * "Failed to save changes" toast that auto-dismissed, so the only lasting trace was a workflow
     * that had silently reverted. These drive the failure through the injected rename rather than
     * hoping the OS produces one.
     */
    const folder = await mkdtemp(join(tmpdir(), "awkit-profile-retry-"));
    const profile = { id: "retry-fixture", name: "first" } as { id: string; name: string };

    let attempts = 0;
    const retries: number[] = [];
    const failTwiceThenSucceed = async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts <= 2) {
        const error = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await rename(from, to);
    };

    const retrying = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: failTwiceThenSucceed,
        sleep: async () => undefined,
        onRetry: (attempt) => retries.push(attempt)
      }
    });

    await retrying.create(profile);
    const afterRetry = await retrying.get(profile.id);
    check("a save survives two transient EPERM renames", afterRetry?.name === "first", JSON.stringify(afterRetry));
    // Cardinality: "it succeeded" is also true when the rename never failed. Assert it actually retried.
    check("it retried rather than succeeding first time", retries.length === 2 && attempts === 3, `retries=${retries.length}, attempts=${attempts}`);

    let permanent: NodeJS.ErrnoException | null = null;
    let permanentAttempts = 0;
    const alwaysEperm = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: async () => {
          permanentAttempts += 1;
          const error = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        },
        sleep: async () => undefined
      }
    });
    try {
      await alwaysEperm.update(profile.id, { id: profile.id, name: "second" });
    } catch (error) {
      permanent = error as NodeJS.ErrnoException;
    }
    check("a persistent EPERM still fails, with the original errno", permanent?.code === "EPERM", String(permanent));
    check("it gave up after a bounded number of attempts", permanentAttempts === 5, `attempts=${permanentAttempts}`);
    const unchanged = await alwaysEperm.get(profile.id);
    check("a failed save leaves the previous file intact", unchanged?.name === "first", JSON.stringify(unchanged));
    const leftovers = (await readdir(folder)).filter((entry) => entry.endsWith(".tmp"));
    check("no temp files are left behind by a failed save", leftovers.length === 0, leftovers.join(", "));

    let nonTransientAttempts = 0;
    let nonTransient: NodeJS.ErrnoException | null = null;
    const enospc = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: async () => {
          nonTransientAttempts += 1;
          const error = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
          error.code = "ENOSPC";
          throw error;
        },
        sleep: async () => undefined
      }
    });
    try {
      await enospc.update(profile.id, { id: profile.id, name: "third" });
    } catch (error) {
      nonTransient = error as NodeJS.ErrnoException;
    }
    check("a non-transient error is NOT retried", nonTransientAttempts === 1, `attempts=${nonTransientAttempts}`);
    check("and it is reported immediately with its own errno", nonTransient?.code === "ENOSPC", String(nonTransient));

    await rm(folder, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nProfile store: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
