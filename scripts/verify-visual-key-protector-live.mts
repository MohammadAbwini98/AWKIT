/**
 * verify:visual-key-protector-live — Phase N, N6.4 (awkit-vra.15.4): the production N6 key protector
 * (`app/main/visualAssertion/visualBaselineKeyProtector.ts`) against the REAL Electron `safeStorage` in the REAL app's
 * main process (production entry point, isolated profile).
 *
 * What is proved, and what is not:
 *   - the protector's source is exactly three operations: availability from the shared secret-storage capability,
 *     `encryptString(base64)` and `base64(decryptString)` — no fallback, override or plaintext branch;
 *   - inside the launched app's main process, with that exact transformation: the OS keystore is available (the same
 *     capability the Secrets card reports through IPC), a random 256-bit key round-trips, the ciphertext is neither the
 *     key nor its base64, two encryptions differ, and a tampered ciphertext does not decrypt to the key;
 *   - NOT proved here: a key FILE written by `VisualBaselineStore` inside the app. In N6.4 nothing in the app creates a
 *     key (only an approval or a grant does, and the approval surface is N6.5); the N6.5 GUI verifier covers it.
 *
 * Electron cannot launch from the Parallels share (KNOWN_ISSUES, GPU error_code=18). Pass a local copy of the same
 * Electron runtime: `npm run verify:visual-key-protector-live -- --electron-dist C:\electron-dist` (or set
 * ELECTRON_OVERRIDE_DIST_PATH). A launch that still fails is reported BLOCKED, never as a pass.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import {
  isolatedLaunchEnv,
  resolveMainWindow,
  signInFirstRun
  // @ts-expect-error Shared GUI helper is intentionally plain ESM JavaScript.
} from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

console.log("The production protector's source:\n");
const source = readFileSync(path.join(root, "app/main/visualAssertion/visualBaselineKeyProtector.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
check("availability comes only from the shared secret-storage capability", /isAvailable: \(\) => getSecretStorageCapability\(\)\.isEncryptionAvailable\(\)/.test(source));
check("protect is safeStorage.encryptString of the key's base64", /protect: \(plain\) => safeStorage\.encryptString\(plain\.toString\("base64"\)\)/.test(source));
check("unprotect is the base64 of safeStorage.decryptString", /unprotect: \(cipher\) => Buffer\.from\(safeStorage\.decryptString\(cipher\), "base64"\)/.test(source));
check("no fallback, override, environment or plaintext branch", !/process\.env|\?\?|\|\||if \(|catch/.test(source.replace(/import[^;]+;/g, "")));

// The KNOWN_ISSUES workaround's local copy of the same Electron runtime is used when it exists, so the check runs as a
// plain `npm run` on the Parallels share; `--electron-dist` or ELECTRON_OVERRIDE_DIST_PATH still take precedence.
const KNOWN_LOCAL_DIST = "C:\\electron-dist";
const distArg = process.argv.indexOf("--electron-dist");
const dist =
  distArg >= 0
    ? process.argv[distArg + 1]
    : process.env.ELECTRON_OVERRIDE_DIST_PATH ?? (process.platform === "win32" && existsSync(path.join(KNOWN_LOCAL_DIST, "electron.exe")) ? KNOWN_LOCAL_DIST : undefined);
const installedVersion = readFileSync(path.join(root, "node_modules/electron/dist/version"), "utf8").trim();
const localVersion = dist && existsSync(path.join(dist, "version")) ? readFileSync(path.join(dist, "version"), "utf8").trim() : installedVersion;
if (localVersion !== installedVersion) {
  console.error(`BLOCKED: the local Electron copy at ${dist} is ${localVersion}, not the installed ${installedVersion}; refresh it (KNOWN_ISSUES).`);
  process.exit(2);
}
const executablePath = dist ? path.join(dist, "electron.exe") : undefined;
console.log(`\nThe real app's main process (${executablePath ?? "default Electron"}):\n`);
if (executablePath && !existsSync(executablePath)) {
  console.error(`BLOCKED: ${executablePath} does not exist`);
  process.exit(2);
}

const { env, electronArgs, cleanup } = isolatedLaunchEnv("awkit-visual-key-live");
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
let blocked: string | undefined;
try {
  try {
    app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env, ...(executablePath ? { executablePath } : {}) });
  } catch (error) {
    blocked = (error instanceof Error ? error.message : String(error)).split("\n")[0];
  }
  if (app) {
    const win = await resolveMainWindow(app).catch(() => undefined);
    if (!win) {
      blocked = "the main window never became ready";
    } else {
      await signInFirstRun(win);
      // No named helpers inside the evaluated callback: tsx wraps them in `__name(...)`, which does not exist there.
      const result = await app.evaluate(({ safeStorage }) => {
        const available = safeStorage.isEncryptionAvailable();
        if (!available) return { available, ok: false };
        const key = Buffer.alloc(32);
        for (let i = 0; i < 32; i += 1) key[i] = Math.floor(Math.random() * 256);
        // The production protector's transformation, verbatim (pinned against its source above).
        const sealed = safeStorage.encryptString(key.toString("base64"));
        const again = safeStorage.encryptString(key.toString("base64"));
        const opened = Buffer.from(safeStorage.decryptString(sealed), "base64");
        const tampered = Buffer.from(sealed);
        tampered[tampered.length - 1] ^= 0xff;
        let tamperedOpens = false;
        try {
          tamperedOpens = Buffer.from(safeStorage.decryptString(tampered), "base64").equals(key);
        } catch {
          tamperedOpens = false;
        }
        return {
          available,
          ok: true,
          roundTrip: opened.equals(key),
          sealedLength: sealed.length,
          containsKey: sealed.includes(key),
          containsBase64: sealed.toString("latin1").includes(key.toString("base64")),
          twoDiffer: !sealed.equals(again),
          tamperedOpens
        };
      });
      const uiAvailable = await win.evaluate(() => window.playwrightFlowStudio.secrets.isAvailable()).catch(() => null);
      check("the OS keystore is available in the app's main process", result.available === true);
      check("the Secrets card's IPC reports the same capability", uiAvailable === result.available, String(uiAvailable));
      check("a random 256-bit key round-trips through the protector's transformation", result.ok && result.roundTrip === true);
      check("the sealed key is neither the key nor its base64", result.ok && result.containsKey === false && result.containsBase64 === false && (result.sealedLength ?? 0) > 32);
      check("two seals of the same key differ (randomised DPAPI blob)", result.ok && result.twoDiffer === true);
      check("a tampered seal does not open to the key", result.ok && result.tamperedOpens === false);
    }
  }
} finally {
  await app?.close().catch(() => undefined);
  cleanup();
}
if (blocked) {
  console.error(`\nBLOCKED: the Electron app did not launch (${blocked}). See KNOWN_ISSUES: run with --electron-dist <local copy>.`);
  console.log(`\n${passed} passed, ${failed} failed, live part BLOCKED`);
  process.exit(2);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
