/**
 * awkit-epz: prove the offline browser is exact, signed, tamper-detecting, and acquired without a
 * floating Playwright/browser install. Regressions that must fail this verifier: a semver range,
 * changed browser/archive hash, unsigned manifest, altered policy/executable, or packaging that
 * builds before validating its inputs.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadDependencyManifest } from "../src/offline/DependencyManifest";
import { validateOfflineSupplyChain } from "../src/offline/SupplyChainIntegrity";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(join(ROOT, "package-lock.json"), "utf8"));
const policyBytes = await readFile(join(ROOT, "resources", "offline-browser-policy.json"));
const policy = JSON.parse(policyBytes.toString("utf8"));
const manifestPath = join(ROOT, "resources", "dependency-manifest.json");
const manifest = await loadDependencyManifest(manifestPath);

console.log("\nPinned acquisition contract:\n");
await check("playwright is pinned exactly", () => assert.equal(packageJson.dependencies.playwright, policy.playwright.version));
await check("@playwright/test is pinned exactly", () => assert.equal(packageJson.devDependencies["@playwright/test"], policy.playwright.version));
await check("lockfile Playwright matches the policy", () => assert.equal(packageLock.packages["node_modules/playwright"].version, policy.playwright.version));
await check("lockfile playwright-core matches the policy", () => assert.equal(packageLock.packages["node_modules/playwright-core"].version, policy.playwright.version));
await check("archive URL is immutable and version-qualified", () => assert.match(policy.browser.archive.url, new RegExp(policy.browser.version.replaceAll(".", "\\."))));
await check("archive SHA-256 is explicit", () => assert.match(policy.browser.archive.sha256, /^[0-9a-f]{64}$/));
await check("executable SHA-256 is explicit", () => assert.match(policy.browser.executableSha256, /^[0-9a-f]{64}$/));
await check("payload tree SHA-256 is explicit", () => assert.match(policy.browser.payload.sha256, /^[0-9a-f]{64}$/));

const prepareSource = await readFile(join(ROOT, "scripts", "prepare-offline-deps.ps1"), "utf8");
await check("preparation has no floating npx Playwright install", () => assert.doesNotMatch(prepareSource, /\bnpx\s+playwright\s+install\b/i));
await check("preparation verifies the archive before extraction", () => {
  assert.match(prepareSource, /Assert-AwkitBrowserArchive[\s\S]*Expand-Archive/);
});
await check("preparation verifies source and staged payload trees", () => {
  assert.ok((prepareSource.match(/Assert-AwkitBrowserTree/g) ?? []).length >= 2);
});

console.log("\nSigned manifest and runtime integrity:\n");
await check("the checked-in dependency manifest has a valid Ed25519 signature", async () => {
  const verification = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "offline-manifest-signature.mjs"), "verify"],
    { cwd: ROOT, encoding: "utf8", windowsHide: true }
  );
  assert.equal(verification.status, 0, `${verification.stdout}\n${verification.stderr}`);
});
await check("runtime supply-chain verification passes on the real staged payload", async () => {
  assert.deepEqual(await validateOfflineSupplyChain(join(ROOT, "resources"), manifest), []);
});

const fixture = await mkdtemp(join(tmpdir(), "awkit-offline-integrity-"));
try {
  await mkdir(join(fixture, "trust"), { recursive: true });
  await mkdir(join(fixture, "browsers", "chromium"), { recursive: true });
  for (const relativePath of [
    "dependency-manifest.json",
    "dependency-manifest.sig",
    "offline-browser-policy.json",
    join("trust", "offline-manifest-public.pem"),
    join("browsers", "chromium", "chrome.exe")
  ]) {
    await copyFile(join(ROOT, "resources", relativePath), join(fixture, relativePath));
  }

  await check("a changed manifest is rejected", async () => {
    await writeFile(join(fixture, "dependency-manifest.json"), Buffer.concat([await readFile(join(fixture, "dependency-manifest.json")), Buffer.from(" ")]));
    assert.ok((await validateOfflineSupplyChain(fixture, manifest)).some((issue) => issue.includes("signed SHA-256")));
    await copyFile(join(ROOT, "resources", "dependency-manifest.json"), join(fixture, "dependency-manifest.json"));
  });
  await check("a changed approval policy is rejected", async () => {
    await writeFile(join(fixture, "offline-browser-policy.json"), Buffer.concat([policyBytes, Buffer.from(" ")]));
    assert.ok((await validateOfflineSupplyChain(fixture, manifest)).some((issue) => issue.includes("approval-policy hash")));
    await copyFile(join(ROOT, "resources", "offline-browser-policy.json"), join(fixture, "offline-browser-policy.json"));
  });
  await check("a changed Chromium executable is rejected", async () => {
    await writeFile(join(fixture, "browsers", "chromium", "chrome.exe"), Buffer.from("tampered"));
    assert.ok((await validateOfflineSupplyChain(fixture, manifest)).some((issue) => issue.includes("executable")));
  });
} finally {
  await rm(fixture, { recursive: true, force: true });
}

console.log("\nPackaging and equivalence wiring:\n");
for (const scriptName of ["package-portable.ps1", "package-per-user-installer.ps1"]) {
  const source = await readFile(join(ROOT, "scripts", scriptName), "utf8");
  await check(`${scriptName} validates inputs before build`, () => {
    assert.ok(source.indexOf("-PackagingInputsOnly") < source.indexOf("npm run build"));
  });
}
const generatorSource = await readFile(join(ROOT, "scripts", "generate-dependency-manifest.ps1"), "utf8");
await check("manifest generation signs before copying release metadata", () => {
  assert.ok(
    generatorSource.indexOf("offline-manifest-signature.mjs") <
      generatorSource.indexOf("Copy-Item -LiteralPath $manifestPath")
  );
});
const comparisonSource = await readFile(join(ROOT, "scripts", "compare-offline-payloads.mjs"), "utf8");
await check("payload equivalence compares path, size and CRC32", () => {
  assert.match(comparisonSource, /decompressed-path-size-crc32/);
  assert.match(comparisonSource, /crc32/);
});
const builderConfig = JSON.parse(await readFile(join(ROOT, "electron-builder.json"), "utf8"));
await check("packaging excludes the redundant vendor browser mirror", () => {
  const vendorResource = builderConfig.extraResources.find(
    (entry: { from?: string }) => entry.from === "vendor"
  );
  assert.ok(vendorResource?.filter.includes("!browsers/**"));
});

const preflight = spawnSync(
  "powershell",
  ["-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "validate-offline-bundle.ps1"), "-PackagingInputsOnly"],
  { cwd: ROOT, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
);
await check("the real staged resources and vendor payloads pass pre-build verification", () => {
  assert.equal(preflight.status, 0, `${preflight.stdout}\n${preflight.stderr}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
