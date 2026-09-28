/**
 * verify:ai-model-pack — Phase L L1.2 model pack import, status, verification and removal.
 *
 * Runs `AiModelPackStore` against real temporary folders with small synthetic GGUF files and an
 * injected manifest, then checks the PRODUCTION manifest's own entries (`src/offline/AiModelManifest.ts`).
 *
 * What makes it fail: a file that is not GGUF being registered; a refused import leaving bytes in the
 * models folder; a tampered, truncated or deleted installed file still reading as installed or passing
 * load verification; a pack retired from the manifest still reading as installed; replacement or removal
 * leaving the old file registered.
 *
 * L8b.1 (E1, E7 supersedes "manifest-only"): what makes it fail now is
 * - a GGUF the manifest does not list being refused, or reading as curated ("installed"), or anything
 *   but `registered` (stored under its SHA-256, never under the user's name, compatibility unchecked);
 * - an import going ahead without free space for the file plus 256 MB, or when the space cannot be
 *   measured, or `preflight` copying anything;
 * - a registry naming a path, or a malformed registry, reading as anything but unreadable;
 * - an old (pre-L8b) registry not loading as before;
 * - a registered model escaping tamper, truncation, deletion or replacement checks;
 * - a symlinked source being stored as a link rather than a copy.
 *
 * Run: npm run verify:ai-model-pack
 */

import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AiModelPackStore, MODEL_IMPORT_HEADROOM_BYTES } from "@src/ai/AiModelPack";
import {
  AI_MODEL_MANIFEST,
  AI_RUNTIME_PIN,
  isValidAiModelManifestEntry,
  type AiModelManifestEntry
} from "@src/offline/AiModelManifest";

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

function gguf(bytes: number, version = 3): Buffer {
  const body = randomBytes(bytes);
  body.write("GGUF", 0, "latin1");
  body.writeUInt32LE(version, 4);
  return body;
}

function entryFor(id: string, content: Buffer): AiModelManifestEntry {
  return {
    id,
    displayName: `Test ${id}`,
    fileName: `${id}.gguf`,
    sizeBytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
    format: "gguf",
    contextTokens: 4096,
    quantization: "Q4_K_M",
    license: { spdx: "Apache-2.0", notice: "THIRD_PARTY_NOTICES.md" },
    capabilities: { jsonSchemaGrammar: true, thinkingToggle: true }
  };
}

const root = await mkdtemp(join(tmpdir(), "awkit-ai-pack-"));
try {
  const source = join(root, "source");
  const models = join(root, "models");
  await mkdir(source);
  const a = gguf(256 * 1024);
  const b = gguf(300 * 1024);
  const entryA = entryFor("pack-a", a);
  const entryB = entryFor("pack-b", b);
  const paths = { a: join(source, "a.gguf"), b: join(source, "b.gguf") };
  await writeFile(paths.a, a);
  await writeFile(paths.b, b);
  const packFiles = async (): Promise<string[]> => (await readdir(models).catch(() => [] as string[])).filter((name) => name !== "registry.json");

  console.log("Refusals leave nothing behind:\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB]);
    check("status starts missing", (await store.status()).status === "missing");
    const refused = async (label: string, path: string, want: string) => {
      const result = await store.import(path);
      check(`${label} is refused as ${want}`, !result.ok && result.code === want, JSON.stringify(result));
    };
    await refused("a missing file", join(source, "nope.gguf"), "NOT_A_FILE");
    await refused("a directory", source, "NOT_A_FILE");
    const notGguf = Buffer.from(a);
    notGguf.write("ZZZZ", 0, "latin1");
    await writeFile(join(source, "fake.gguf"), notGguf);
    await refused("a file without the GGUF magic", join(source, "fake.gguf"), "NOT_GGUF");
    await writeFile(join(source, "v9.gguf"), gguf(a.length, 9));
    await refused("an unsupported GGUF version", join(source, "v9.gguf"), "NOT_GGUF");
    const full = new AiModelPackStore(models, [entryA, entryB], undefined, async () => a.length + MODEL_IMPORT_HEADROOM_BYTES - 1);
    const short = await full.import(paths.a);
    check("one byte short of the file plus 256 MB of free space is refused", !short.ok && short.code === "INSUFFICIENT_SPACE", JSON.stringify(short));
    const unmeasured = await new AiModelPackStore(models, [entryA, entryB], undefined, async () => null).import(paths.a);
    check("free space that cannot be measured is refused (fail closed)", !unmeasured.ok && unmeasured.code === "INSUFFICIENT_SPACE", JSON.stringify(unmeasured));
    check("no pack or temp file was left in the models folder", (await packFiles()).length === 0, (await packFiles()).join(","));
    check("status is still missing", (await store.status()).status === "missing");
  }

  console.log("\nL8b.1: the preflight measures and copies nothing:\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB], undefined, async () => 10 * 1024 ** 3);
    const pre = await store.preflight(paths.a);
    check(
      "it names the file, its size, the free space and the size plus 256 MB",
      pre.ok && pre.preflight.fileName === "a.gguf" && pre.preflight.sizeBytes === a.length && pre.preflight.freeBytes === 10 * 1024 ** 3 && pre.preflight.requiredBytes === a.length + MODEL_IMPORT_HEADROOM_BYTES && pre.preflight.spaceOk,
      JSON.stringify(pre)
    );
    const tight = await new AiModelPackStore(models, [entryA, entryB], undefined, async () => a.length + MODEL_IMPORT_HEADROOM_BYTES - 1).preflight(paths.a);
    check("it says so when the space is one byte short", tight.ok && !tight.preflight.spaceOk);
    const notGguf = await store.preflight(join(source, "fake.gguf"));
    const missing = await store.preflight(join(source, "nope.gguf"));
    check("it refuses a non-GGUF file and a missing one", !notGguf.ok && notGguf.code === "NOT_GGUF" && !missing.ok && missing.code === "NOT_A_FILE");
    check("it copied nothing and registered nothing", (await packFiles()).length === 0 && (await store.status()).status === "missing");
    const exact = await new AiModelPackStore(models, [entryA, entryB], undefined, async () => a.length + MODEL_IMPORT_HEADROOM_BYTES).import(paths.a);
    check("exactly the file plus 256 MB of free space is enough", exact.ok && exact.entry?.id === "pack-a", JSON.stringify(exact));
    await store.remove();
  }

  console.log("\nL8b.1: a GGUF the manifest does not list is registered, never curated (E7):\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB]);
    const odd = gguf(a.length + 7);
    const oddPath = join(source, "My Model (v2) é.gguf");
    await writeFile(oddPath, odd);
    const oddSha = createHash("sha256").update(odd).digest("hex");
    const registered = await store.import(oddPath);
    check(
      "a size no manifest entry has is copied and registered, not refused",
      registered.ok && registered.entry === null && registered.external.sha256 === oddSha && registered.external.sizeBytes === odd.length,
      JSON.stringify(registered)
    );
    check("it is stored under its checksum, never under the user's file name", (await packFiles()).join(",") === `${oddSha}.gguf`, (await packFiles()).join(","));
    check("the stored bytes are the source bytes", (await readFile(store.modelPath(oddSha))).equals(odd));
    const status = await store.status();
    check(
      "it reads registered with its size and the source's own name, not installed",
      status.status === "registered" && status.external.sha256 === oddSha && status.external.sizeBytes === odd.length && status.external.fileName === "My Model (v2) é.gguf",
      JSON.stringify(status)
    );
    const registry = JSON.parse(await readFile(join(models, "registry.json"), "utf8")) as { active: Record<string, unknown> };
    check(
      "the registry holds the checksum, time, size and name only: no directory or path",
      JSON.stringify(Object.keys(registry.active).sort()) === JSON.stringify(["external", "installedAt", "sha256"]) &&
        JSON.stringify(Object.keys(registry.active.external as object).sort()) === JSON.stringify(["fileName", "sizeBytes"]) &&
        !JSON.stringify(registry).includes(source.replace(/\\/g, "\\\\")),
      JSON.stringify(registry)
    );
    check("a new session verifies its checksum before load", await new AiModelPackStore(models, [entryA, entryB]).verifyForLoad(oddSha));

    const twin = gguf(a.length);
    const twinPath = join(source, "twin.gguf");
    await writeFile(twinPath, twin);
    const twinResult = await store.import(twinPath);
    check("the right size with the wrong bytes is registered, not taken for the curated pack", twinResult.ok && twinResult.entry === null && (await store.status()).status === "registered");

    const listed = await new AiModelPackStore(models, [entryA, entryB, entryFor("pack-twin", twin)]).status();
    check("a release that later lists those bytes reads them as its curated pack", listed.status === "installed" && listed.entry.id === "pack-twin", JSON.stringify(listed));

    const installed = store.modelPath(createHash("sha256").update(twin).digest("hex"));
    const tampered = Buffer.from(twin);
    tampered[2000] ^= 0xff;
    await writeFile(installed, tampered);
    const fresh = new AiModelPackStore(models, [entryA, entryB]);
    check("a same-size edit of a registered model fails load verification", !(await fresh.verifyForLoad(createHash("sha256").update(twin).digest("hex"))));
    const afterTamper = await fresh.status();
    check("...and reads invalid (HASH_MISMATCH) for the session", afterTamper.status === "invalid" && afterTamper.reason === "HASH_MISMATCH", JSON.stringify(afterTamper));
    await writeFile(installed, odd);
    const replacedOnDisk = await new AiModelPackStore(models, [entryA, entryB]).status();
    check("another model swapped in under its name reads invalid (SIZE_MISMATCH)", replacedOnDisk.status === "invalid" && replacedOnDisk.reason === "SIZE_MISMATCH", JSON.stringify(replacedOnDisk));
    await rm(installed);
    const deleted = await new AiModelPackStore(models, [entryA, entryB]).status();
    check("a deleted registered model reads invalid (FILE_MISSING)", deleted.status === "invalid" && deleted.reason === "FILE_MISSING");

    const linkPath = join(source, "linked.gguf");
    let linked = false;
    try {
      await symlink(oddPath, linkPath, "file");
      linked = true;
    } catch {
      console.log("  · NOT RUN: this account cannot create a file symlink, so the symlinked-source case did not run");
    }
    if (linked) {
      const viaLink = await store.import(linkPath);
      const stored = await lstat(store.modelPath(oddSha));
      check("a symlinked source is copied: the stored model is a regular file with the target's bytes", viaLink.ok && stored.isFile() && !stored.isSymbolicLink() && (await readFile(store.modelPath(oddSha))).equals(odd));
    }

    await store.remove();
    check("remove unregisters a registered model and deletes its file", (await store.status()).status === "missing" && (await packFiles()).length === 0);
  }

  console.log("\nL8b.1: registry shapes, old and forged:\n");
  {
    const registryPath = join(models, "registry.json");
    const statusOf = async (active: unknown) => {
      await writeFile(registryPath, JSON.stringify({ schemaVersion: 1, active }), "utf8");
      return new AiModelPackStore(models, [entryA, entryB]).status();
    };
    await writeFile(join(models, `${entryA.sha256}.gguf`), a);
    const old = await statusOf({ sha256: entryA.sha256, installedAt: "2026-09-01T00:00:00.000Z" });
    check("a pre-L8b registry for a curated pack loads unchanged (installed)", old.status === "installed" && old.entry.id === "pack-a", JSON.stringify(old));
    const oldRetired = await statusOf({ sha256: createHash("sha256").update("retired").digest("hex"), installedAt: "2026-09-01T00:00:00.000Z" });
    check("a pre-L8b registry for an unlisted checksum still reads incompatible, never registered", oldRetired.status === "incompatible" && oldRetired.reason === "NOT_IN_MANIFEST", JSON.stringify(oldRetired));
    const forged: Array<[string, unknown]> = [
      ["a file name with a path", { sizeBytes: a.length, fileName: "..\\..\\evil.gguf" }],
      ["a file name with a forward slash", { sizeBytes: a.length, fileName: "dir/evil.gguf" }],
      ["a file name with a control character", { sizeBytes: a.length, fileName: `evil${String.fromCharCode(1)}.gguf` }],
      ["a zero size", { sizeBytes: 0, fileName: "x.gguf" }],
      ["a negative size", { sizeBytes: -5, fileName: "x.gguf" }],
      ["a size as a string", { sizeBytes: "5", fileName: "x.gguf" }],
      ["a null external record", null]
    ];
    for (const [label, external] of forged) {
      const result = await statusOf({ sha256: entryA.sha256, installedAt: "2026-09-01T00:00:00.000Z", external });
      check(`a registry with ${label} reads unreadable`, result.status === "invalid" && result.reason === "REGISTRY_UNREADABLE", JSON.stringify(result));
    }
    await rm(registryPath);
    await rm(join(models, `${entryA.sha256}.gguf`));
  }

  console.log("\nImport, then load verification:\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB]);
    const imported = await store.import(paths.a);
    check("a listed pack imports as that curated pack", imported.ok && imported.entry?.id === "pack-a" && imported.external === null, JSON.stringify(imported));
    check("it is stored under its checksum", (await packFiles()).join(",") === `${entryA.sha256}.gguf`, (await packFiles()).join(","));
    check("the stored bytes are the source bytes", (await readFile(store.modelPath(entryA.sha256))).equals(a));
    const status = await store.status();
    check("status reads installed with the manifest entry", status.status === "installed" && status.entry.id === "pack-a");
    check("the source file is untouched", (await readFile(paths.a)).equals(a));
    const fresh = new AiModelPackStore(models, [entryA, entryB]);
    check("a new session verifies the checksum before load", await fresh.verifyForLoad(entryA.sha256));
  }

  console.log("\nTampering is caught:\n");
  {
    const installed = join(models, `${entryA.sha256}.gguf`);
    const tampered = Buffer.from(a);
    tampered[1000] ^= 0xff;
    await writeFile(installed, tampered);
    const store = new AiModelPackStore(models, [entryA, entryB]);
    check("a same-size edit still passes the cheap status check", (await store.status()).status === "installed");
    check("but fails load verification", !(await store.verifyForLoad(entryA.sha256)));
    const after = await store.status();
    check("and the pack is invalid for the rest of the session", after.status === "invalid" && after.reason === "HASH_MISMATCH", JSON.stringify(after));

    await truncate(installed, 100);
    const truncated = await new AiModelPackStore(models, [entryA, entryB]).status();
    check("a truncated file is invalid (SIZE_MISMATCH)", truncated.status === "invalid" && truncated.reason === "SIZE_MISMATCH");
    await rm(installed);
    const gone = await new AiModelPackStore(models, [entryA, entryB]).status();
    check("a deleted file is invalid (FILE_MISSING)", gone.status === "invalid" && gone.reason === "FILE_MISSING");
  }

  console.log("\nManifest changes, replacement and removal:\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB]);
    check("re-importing restores the pack", (await store.import(paths.a)).ok && (await store.status()).status === "installed");
    const retired = await new AiModelPackStore(models, [entryB]).status();
    check("a pack a later release retired reads incompatible", retired.status === "incompatible" && retired.reason === "NOT_IN_MANIFEST");

    await writeFile(join(models, ".import-99-1.tmp"), "left by a crashed import");
    const replaced = await store.import(paths.b);
    check("a second pack replaces the first", replaced.ok && replaced.entry?.id === "pack-b");
    check("the old pack file and the stale temp file are swept", (await packFiles()).join(",") === `${entryB.sha256}.gguf`, (await packFiles()).join(","));
    const status = await store.status();
    check("status names the replacement", status.status === "installed" && status.entry.id === "pack-b");

    await store.remove();
    check("remove unregisters the pack", (await store.status()).status === "missing");
    check("remove deletes its file", (await packFiles()).length === 0);
    await store.remove();
    check("remove is idempotent", (await store.status()).status === "missing");

    await writeFile(join(models, "registry.json"), "{ not json", "utf8");
    const corrupt = await new AiModelPackStore(models, [entryA, entryB]).status();
    check("an unreadable registry reads invalid, not installed", corrupt.status === "invalid" && corrupt.reason === "REGISTRY_UNREADABLE");
  }

  console.log("\nMalformed manifest entries can never admit a pack:\n");
  {
    const dir = join(root, "models-malformed");
    const bad: Array<[string, AiModelManifestEntry]> = [
      ["an uppercase checksum", { ...entryA, sha256: entryA.sha256.toUpperCase() }],
      ["a short checksum", { ...entryA, sha256: entryA.sha256.slice(0, 63) }],
      ["a file name with a path", { ...entryA, fileName: "..\\evil.gguf" }],
      ["a model without grammar support", { ...entryA, capabilities: { jsonSchemaGrammar: false, thinkingToggle: true } }],
      ["a non-GGUF format", { ...entryA, format: "safetensors" as "gguf" }],
      ["a zero size", { ...entryA, sizeBytes: 0 }]
    ];
    for (const [label, entry] of bad) {
      check(`${label} is not a valid entry`, !isValidAiModelManifestEntry(entry));
      const result = await new AiModelPackStore(dir, [entry]).import(paths.a);
      // Since L8b.1 the file itself is registered (E7); what a malformed entry must never do is make it curated.
      check(`${label} cannot make the file its curated pack (it is only registered)`, result.ok && result.entry === null, JSON.stringify(result));
    }
    check("a well-formed entry is valid", isValidAiModelManifestEntry(entryA));
  }

  console.log("\nThe production manifest:\n");
  {
    check("every production entry is well formed", AI_MODEL_MANIFEST.every(isValidAiModelManifestEntry));
    check("production ids are unique", new Set(AI_MODEL_MANIFEST.map((e) => e.id)).size === AI_MODEL_MANIFEST.length);
    check("production checksums are unique", new Set(AI_MODEL_MANIFEST.map((e) => e.sha256)).size === AI_MODEL_MANIFEST.length);
    check("the runtime pin names llama.cpp", AI_RUNTIME_PIN.name === "llama.cpp");
    console.log(`  · ${AI_MODEL_MANIFEST.length} pinned pack(s); runtime build ${AI_RUNTIME_PIN.build ?? "not pinned"}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
