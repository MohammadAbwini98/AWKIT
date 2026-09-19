/**
 * verify:ai-model-pack — Phase L L1.2 model pack import, status, verification and removal.
 *
 * Runs `AiModelPackStore` against real temporary folders with small synthetic GGUF files and an
 * injected manifest, then checks the PRODUCTION manifest's own entries (`src/offline/AiModelManifest.ts`).
 *
 * What makes it fail: a file that is not GGUF, not the listed size, or not the listed SHA-256 being
 * registered; a refused import leaving bytes in the models folder; a tampered, truncated or deleted
 * installed file still reading as installed or passing load verification; a pack retired from the
 * manifest still reading as installed; replacement or removal leaving the old file registered.
 *
 * Run: npm run verify:ai-model-pack
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AiModelPackStore } from "@src/ai/AiModelPack";
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
    await writeFile(join(source, "odd.gguf"), gguf(a.length + 7));
    await refused("a size no manifest entry has", join(source, "odd.gguf"), "SIZE_NOT_IN_MANIFEST");
    await writeFile(join(source, "twin.gguf"), gguf(a.length));
    await refused("the right size with the wrong bytes", join(source, "twin.gguf"), "NOT_IN_MANIFEST");
    check("no pack or temp file was left in the models folder", (await packFiles()).length === 0, (await packFiles()).join(","));
    check("status is still missing", (await store.status()).status === "missing");
  }

  console.log("\nImport, then load verification:\n");
  {
    const store = new AiModelPackStore(models, [entryA, entryB]);
    const imported = await store.import(paths.a);
    check("a listed pack imports", imported.ok && imported.entry.id === "pack-a", JSON.stringify(imported));
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
    check("a second pack replaces the first", replaced.ok && replaced.entry.id === "pack-b");
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
      check(`${label} cannot admit a pack`, !result.ok, JSON.stringify(result));
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
