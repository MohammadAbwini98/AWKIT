/**
 * Secret-storage capability seam + SET-013 unavailable-store GUI (owner decision 2026-07-29,
 * bd `awkit-8ri`).
 *
 * Verifier class: **real-browser** (it launches the real Electron app twice) with a static
 * source/artifact-hygiene section.
 *
 * Two things are proved, and they are different claims:
 *
 *   1. **The seam is real and the substitution is confined to test tooling.** No environment
 *      variable, flag, setting or IPC channel changes the capability; the test composition root is
 *      not reachable from the production entry point; it builds to a directory packaging excludes;
 *      and `configureSecretStorageCapability` refuses outright in a packaged build. Four independent
 *      properties, because any one of them alone could be undone by a plausible edit.
 *
 *   2. **The product genuinely behaves correctly when the keystore is unavailable** — the A/B pair.
 *      The SAME application is launched from the production entry point (keystore available) and
 *      from the test composition root (unavailable). Asserting only the unavailable side would be
 *      satisfied by a Secrets card that is broken for everyone; the available side is the control
 *      that proves the difference is the injected capability.
 *
 * Run: npx tsx scripts/verify-secret-storage-seam.mts   (after `npm run build && npm run build:test-roots`)
 */
import { _electron as electron, type Page } from "playwright";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
// @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

/**
 * Source with comments removed. These modules deliberately EXPLAIN what must not exist ("not
 * `isProductionOffline`", "see testing/unavailableSecretStorageRoot"), so scanning raw text finds the
 * documentation rather than a violation. Scan code; keep the prose.
 */
const readCode = (rel: string): string =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const CAPABILITY = "app/main/secretStorageCapability.ts";
const TEST_ROOT = "app/main/testing/unavailableSecretStorageRoot.ts";
const TEST_ROOT_DIR = "app/main/testing";
const BUILT_TEST_ROOT = "out/test-main/main.js";

function walk(dir: string, test: (name: string) => boolean): string[] {
  const out: string[] = [];
  const absolute = join(root, dir);
  if (!existsSync(absolute)) return out;
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (test(entry.name)) out.push(relative(root, full).split(sep).join("/"));
    }
  };
  visit(absolute);
  return out;
}

console.log("Secret-storage capability seam (SET-013)\n");

// ── 1. No runtime override exists in the shipped secret path ─────────────────────────────────────
console.log("No runtime override:");
const capabilitySource = read(CAPABILITY);
const secretStoreSource = read("app/main/secretStore.ts");
const secretsIpcSource = read("app/main/ipc/secrets.ipc.ts");

for (const [label, source] of [
  ["the capability module", capabilitySource],
  ["secretStore.ts", secretStoreSource],
  ["secrets.ipc.ts", secretsIpcSource]
] as const) {
  // `app.isPackaged` is read in the capability module and is not an env var; everything else that
  // reaches process.env would be a way to flip the decision from outside the composition root.
  const envReads = [...source.matchAll(/process\.env(?:\.|\[)\s*["']?([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  check(`${label} reads no environment variable`, envReads.length === 0, envReads.join(", "));
}
check(
  "no SPECTER_* / AWKIT_* secret-storage override exists anywhere in app/",
  !walk("app", (n) => /\.(ts|tsx)$/.test(n)).some((rel) =>
    /(SPECTER|AWKIT)_[A-Z_]*(SECRET|ENCRYPT|SAFE_?STORAGE|KEYSTORE)[A-Z_]*/.test(read(rel))
  )
);
check(
  "no IPC channel can change the capability",
  !/configureSecretStorageCapability/.test(secretsIpcSource) &&
    !walk("app/main/ipc", (n) => n.endsWith(".ts")).some((rel) =>
      /configureSecretStorageCapability/.test(read(rel))
    )
);
check(
  "the preload bridge exposes no capability setter",
  !/configureSecretStorageCapability|SecretStorageCapability/.test(read("app/main/preload.ts"))
);
check(
  "encryption itself is NOT injectable — only the availability decision is",
  /safeStorage\.encryptString/.test(secretStoreSource) && /safeStorage\.decryptString/.test(secretStoreSource)
);

// ── 2. The substitution is refused in a packaged build ───────────────────────────────────────────
console.log("\nPackaged builds refuse substitution:");
check(
  "configureSecretStorageCapability throws when app.isPackaged",
  /isPackagedBuild\(\)\s*\)\s*\{[\s\S]{0,240}?throw new Error/.test(capabilitySource)
);
const capabilityCode = readCode(CAPABILITY);
check(
  "packaging is decided by app.isPackaged, not the PRODUCTION_OFFLINE env helper",
  /app\.isPackaged/.test(capabilityCode) && !/isProductionOffline\s*\(/.test(capabilityCode),
  "isProductionOffline() honours an env var and must not gate this"
);
check("an unconfigured process uses the real capability", /configured \?\? productionCapability/.test(capabilitySource));

// ── 3. The test root is unreachable from the production entry point ──────────────────────────────
console.log("\nTest root is not part of the application:");
const productionFiles = walk("app", (n) => /\.(ts|tsx)$/.test(n)).filter(
  (rel) => !rel.startsWith(TEST_ROOT_DIR)
);
check(`there are production files to scan (found ${productionFiles.length})`, productionFiles.length >= 50);
const importers = productionFiles.filter((rel) =>
  /(?:from|import\()\s*["'`][^"'`]*testing\/unavailableSecretStorageRoot/.test(readCode(rel))
);
check("no production module imports the test composition root", importers.length === 0, importers.join(", "));
check(
  "the test root imports the app, not the other way round",
  read(TEST_ROOT).includes('await import("../main")')
);
check(
  "the test root is built by its own config, to its own output directory",
  read("electron.vite.test-roots.config.ts").includes('outDir: "out/test-main"')
);
check(
  "the production build config does not build the test root",
  !read("electron.vite.config.ts").includes("testing/unavailableSecretStorageRoot")
);

// ── 4. Packaging excludes the built test root ────────────────────────────────────────────────────
console.log("\nPackaging excludes it:");
const builder = JSON.parse(read("electron-builder.json")) as { files: string[] };
check("electron-builder.json ships out/** (so an exclusion is genuinely required)", builder.files.includes("out/**"));
check("electron-builder.json excludes out/test-main/**", builder.files.includes("!out/test-main/**"));
check(
  "the exclusion comes AFTER the inclusion it must override",
  builder.files.indexOf("!out/test-main/**") > builder.files.indexOf("out/**")
);
if (existsSync(join(root, BUILT_TEST_ROOT))) {
  const mainBundle = read("out/main/main.js");
  check(
    "the production main bundle contains no unavailable-capability stub",
    !/isEncryptionAvailable:\s*\(\)\s*=>\s*false/.test(mainBundle)
  );
} else {
  check("built test root present for artifact comparison", false, "run `npm run build:test-roots`");
}

// ── 5. The A/B GUI pair ──────────────────────────────────────────────────────────────────────────
console.log("\nSET-013 — the Secrets card under an unavailable keystore:");

const UNAVAILABLE_TEXT = /Secure storage is not available on this system/i;

async function inspectSecretsCard(appDir: string): Promise<{
  available: boolean;
  bannerCount: number;
  nameInputCount: number;
  addButtonCount: number;
  setRefused: boolean;
  listAfterSet: number;
  errorText: string;
}> {
  const { env, cleanup } = isolatedLaunchEnv("awkit-set013");
  const app = await electron.launch({ args: [appDir], cwd: root, env });
  try {
    const win: Page = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);

    const available = await win.evaluate(() => window.playwrightFlowStudio.secrets.isAvailable());

    // Attempt a real write through the same IPC the card uses, then re-read the list. This is the
    // assertion that matters: "refuses to store" has to mean nothing was stored, not merely that a
    // control was hidden.
    const setRefused = await win
      .evaluate(() => window.playwrightFlowStudio.secrets.set("set013_probe", "must-not-persist"))
      .then(() => false)
      .catch(() => true);
    const listAfterSet = (await win.evaluate(() => window.playwrightFlowStudio.secrets.list())).length;

    await win.getByRole("button", { name: /^Settings$/ }).first().click().catch(() => undefined);
    await win.waitForTimeout(900);

    const bannerCount = await win.getByText(UNAVAILABLE_TEXT).count();
    // Scope to the Secrets card. `.settings-secret-form` is also used by the Java-runtime and
    // Oracle-driver cards, so an unscoped count reported 3 vs 2 instead of 1 vs 0 — the delta was
    // right but the number was measuring three cards at once, which would have hidden a regression
    // in any one of them behind the others.
    const secretsCard = win
      .locator("section.settings-card")
      .filter({ hasText: "Store portal passwords and API tokens" });
    const nameInputCount = await secretsCard.locator('.settings-secret-form input[type="text"]').count();
    const addButtonCount = await secretsCard.locator(".settings-secret-form button").count();
    const errorText = bannerCount ? await win.getByText(UNAVAILABLE_TEXT).first().innerText() : "";

    return { available, bannerCount, nameInputCount, addButtonCount, setRefused, listAfterSet, errorText };
  } finally {
    await app.close().catch(() => undefined);
    cleanup();
  }
}

const production = await inspectSecretsCard(root);
const testRoot = await inspectSecretsCard(join(root, "out", "test-main"));

// Control: the production app on this machine has a working keystore. Without this, every assertion
// below is equally satisfied by a Secrets card that is simply broken.
check("CONTROL: the production entry point reports the keystore AVAILABLE", production.available === true);
check("CONTROL: production shows the secret entry form", production.nameInputCount >= 1);
check("CONTROL: production shows no unavailable banner", production.bannerCount === 0);
check("CONTROL: production persists a secret", production.listAfterSet >= 1, String(production.listAfterSet));

check("the test composition root reports the keystore UNAVAILABLE", testRoot.available === false);
check("the unavailable state is explained on the page", testRoot.bannerCount >= 1, testRoot.errorText);
check(
  "the explanation is a real message, not an empty element",
  testRoot.errorText.trim().length >= 20,
  testRoot.errorText
);
check(
  "the secret entry form is withdrawn, not left enabled",
  testRoot.nameInputCount === 0,
  `test-root inputs=${testRoot.nameInputCount}, production inputs=${production.nameInputCount}`
);
check(
  "no Add/Update control is offered",
  testRoot.addButtonCount === 0,
  `test-root buttons=${testRoot.addButtonCount}, production buttons=${production.addButtonCount}`
);
check("nothing was persisted by the write attempt", testRoot.listAfterSet === 0, String(testRoot.listAfterSet));
check(
  "the two launches genuinely differ (the injected capability is the only variable)",
  production.available !== testRoot.available && production.nameInputCount !== testRoot.nameInputCount
);

console.log(`\n${passed} PASS / ${failed} FAIL — secret-storage capability seam`);
if (failed > 0) process.exitCode = 1;
