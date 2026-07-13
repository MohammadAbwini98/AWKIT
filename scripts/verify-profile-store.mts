// Durability checks for the JSON profile store (src/storage/ProfileStore.ts) that persists the
// user's flows / workflows / data sources / reports. No Electron — pure fs semantics in a temp dir.
//
// Guards audit findings A1 (non-atomic write), A2 (silent corrupt-file drop), A3 (non-atomic
// id-rename update), and S1 (concurrent-save race).
//
// Run: npx tsx scripts/verify-profile-store.mts
import { mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
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

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nProfile store: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
