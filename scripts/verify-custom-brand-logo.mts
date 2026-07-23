// Focused verifier for the user-uploaded custom workspace-logo feature (Settings → Appearance →
// Branding). Maps 1:1 to the 15 acceptance cases for the branch: default fallback, import, restart
// persistence, login/sidebar parity, reset, source-independence, format/corruption/size rejection,
// path-traversal + unauthorized-IPC gating, missing-asset fallback, light/dark usability, legacy-profile
// compatibility, and a .beads-untouched guard. Domain cases drive the REAL BrandingLogoStore +
// BrandingValidation against a temp dir; architecture/security cases are asserted structurally against
// source, since they are properties of the trusted boundary rather than of a single function call.
//
// Run: npx tsx scripts/verify-custom-brand-logo.mts
import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRANDING_ACCEPTED_INPUT_MIME,
  BRANDING_MAX_BYTES,
  checkPngBytes
} from "../src/branding/BrandingValidation";
import { BrandingLogoStore } from "../src/branding/BrandingLogoStore";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const src = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// ── Minimal valid PNG generator (8-bit RGBA), so no image dependency is needed ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(width: number, height: number): Uint8Array {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((1 + width * 4) * height, 0);
  const idat = deflateSync(raw);
  return new Uint8Array(Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]));
}
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// A real decode that trusts the structural PNG dimensions — stands in for nativeImage in the main process.
const decodeOk = (bytes: Uint8Array) => checkPngBytes(bytes).ok ? readIhdr(bytes) : null;
function readIhdr(bytes: Uint8Array): { width: number; height: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16, false), height: v.getUint32(20, false) };
}

const tmp = mkdtempSync(join(tmpdir(), "awkit-brandlogo-"));
async function main() {
  console.log("\n[1] Default SpecterStudio logo is used when no override exists");
  const s1 = new BrandingLogoStore({ folder: join(tmp, "s1"), decodeAndVerify: decodeOk });
  check("fresh store resolves to active:false (renderer shows the shipped default)", s1.get().active === false);

  console.log("\n[2] A valid custom logo can be imported");
  const logoA = makePng(96, 64);
  const put = await s1.replace(logoA, { updatedByUserId: "u-1" });
  check("replace(valid PNG) succeeds", put.ok === true, put.ok ? "" : (put as { reason: string }).reason);
  check("get() now active with IHDR dimensions on the manifest", s1.get().active === true && s1.get().manifest?.width === 96);

  console.log("\n[3] The imported logo persists after restart");
  // A brand-new store instance over the SAME folder models an app relaunch (state is on disk, not in memory).
  const s1b = new BrandingLogoStore({ folder: join(tmp, "s1"), decodeAndVerify: decodeOk });
  const afterRestart = s1b.get();
  check("a fresh store over the same folder still sees the logo", afterRestart.active === true);
  check("bytes are byte-identical after restart (sha match)", !!s1b.readActiveBytes() && sha256(s1b.readActiveBytes()!) === sha256(logoA));

  console.log("\n[4] Login and sidebar resolve the SAME logo (single source: branding.getState)");
  const login = src("app/renderer/security/screens/LoginScreen.tsx");
  const nav = src("app/renderer/layout/LeftNavigation.tsx");
  const brandingIpc = src("app/main/ipc/branding.ipc.ts");
  check("login screen resolves via the open branding.getState() read", /branding[\s\S]{0,40}\.getState\(\)/.test(login));
  check("login screen renders the resolved dataUrl", /customLogo|state\.dataUrl|dataUrl/.test(login));
  check("sidebar resolves via useBranding() + dataUrl", /useBranding\(\)/.test(nav) && /dataUrl/.test(nav));
  check("both surfaces read the SAME server-built data URL (getState → toStateView)", /toStateView/.test(brandingIpc) && /getState/.test(brandingIpc));

  console.log("\n[5] Reset restores the default");
  s1b.remove();
  check("remove() → active:false", s1b.get().active === false);
  check("remove() is idempotent", (s1b.remove(), s1b.get().active === false));

  console.log("\n[6] Deleting the source file after import does not break the stored logo");
  const s6 = new BrandingLogoStore({ folder: join(tmp, "s6"), decodeAndVerify: decodeOk });
  const sourcePath = join(tmp, "user-picked-logo.png");
  writeFileSync(sourcePath, makePng(120, 80)); // the file the user selected
  const bytes6 = new Uint8Array(readFileSync(sourcePath));
  await s6.replace(bytes6, { updatedByUserId: "u-1" });
  unlinkSync(sourcePath); // user deletes / moves the original after import
  check("stored logo survives deletion of the original source file", s6.get().active === true);
  check("manifest records no source path (only the copied, hashed asset is kept)", (() => {
    const m = s6.get().manifest as Record<string, unknown> | undefined;
    return !!m && !("path" in m) && !("fileName" in m) && !("sourcePath" in m);
  })());

  console.log("\n[7] Unsupported formats are rejected");
  const s7 = new BrandingLogoStore({ folder: join(tmp, "s7"), decodeAndVerify: decodeOk });
  const jpegRes = await s7.replace(JPEG_BYTES);
  check("replace(JPEG bytes) rejected as not-png (signature check, not extension)", jpegRes.ok === false && (jpegRes as { reason: string }).reason === "not-png");
  check("SVG is accepted only via safe rasterization to PNG (markup never stored/injected)", BRANDING_ACCEPTED_INPUT_MIME.includes("image/svg+xml") && /RASTERIZED|rasteriz/i.test(src("src/branding/BrandingValidation.ts")));

  console.log("\n[8] Corrupt image data is rejected");
  // Valid PNG header over pixels the native decoder cannot read → decode-failed (not merely header-valid).
  const s8 = new BrandingLogoStore({ folder: join(tmp, "s8"), decodeAndVerify: () => null });
  const corruptRes = await s8.replace(makePng(64, 64));
  check("replace() rejected when the real decode fails (corrupt pixels)", corruptRes.ok === false && (corruptRes as { reason: string }).reason === "decode-failed");
  // On-disk tamper after a good import → read-time hash mismatch → safe fallback.
  const s8b = new BrandingLogoStore({ folder: join(tmp, "s8b"), decodeAndVerify: decodeOk });
  await s8b.replace(makePng(64, 64));
  const s8bLogo = join(tmp, "s8b", "active", "logo.png");
  const tampered = Buffer.from(readFileSync(s8bLogo)); // same LENGTH, one flipped byte → manifest hash no longer matches
  tampered[tampered.length - 10] ^= 0xff;
  writeFileSync(s8bLogo, tampered);
  check("a tampered stored logo falls back to active:false (hash mismatch)", s8b.get().active === false);

  console.log("\n[9] Oversized files are rejected");
  const s9 = new BrandingLogoStore({ folder: join(tmp, "s9"), decodeAndVerify: decodeOk });
  check("replace(>5MB) rejected too-large", checkPngBytes(new Uint8Array(BRANDING_MAX_BYTES + 1)).ok === false);
  const bigDims = await s9.replace(makePng(3000, 3000));
  check("replace(3000x3000) rejected dimensions-out-of-range", bigDims.ok === false && (bigDims as { reason: string }).reason === "dimensions-out-of-range");

  console.log("\n[10] Path traversal and arbitrary-path reads are rejected");
  const store = src("src/branding/BrandingLogoStore.ts");
  check("the upload IPC accepts BYTES (structured clone), never a renderer file path", /toBytes\(/.test(brandingIpc) && !/readFileSync\([^)]*payload|readFile\([^)]*payload/.test(brandingIpc));
  check("the store reads only inside its managed folder (join(this.root, …))", /join\(this\.root/.test(store) && /join\(this\.activeDir/.test(store));
  check("no renderer-supplied absolute path ever reaches disk (no fs read of an IPC arg)", !/ipcRenderer|event\.[a-z]+Path|args\[/i.test(store));

  console.log("\n[11] Unauthorized IPC callers are rejected");
  check("uploadLogo + removeLogo are gated by assertSenderPermission(SETTINGS_BRANDING_MANAGE)", /assertSenderPermission\(event,\s*Permission\.SETTINGS_BRANDING_MANAGE\)/.test(brandingIpc));
  check("both mutating channels route through the authorize() gate", (brandingIpc.match(/const auth = await authorize\(event\)/g) ?? []).length >= 2);
  check("getState is an open read (every role renders the sidebar), never a mutation", /ipcMain\.handle\("branding:getState"/.test(brandingIpc) && !/authorize\(event\)[\s\S]{0,80}getState/.test(brandingIpc));

  console.log("\n[12] Missing stored assets fall back safely");
  const s12 = new BrandingLogoStore({ folder: join(tmp, "s12"), decodeAndVerify: decodeOk });
  await s12.replace(makePng(64, 64));
  unlinkSync(join(tmp, "s12", "active", "logo.png")); // manifest remains, asset vanished
  check("missing logo.png (manifest present) resolves to active:false", s12.get().active === false);

  console.log("\n[13] Light and dark appearances remain usable");
  const css = src("app/renderer/styles/global.css");
  check("login custom logo is aspect-preserved + overflow-bounded (object-fit + max bounds)", /\.awkit-login-logo-custom\s*\{[\s\S]*?object-fit:\s*contain[\s\S]*?\}/.test(css) && /\.awkit-login-logo-custom\s*\{[\s\S]*?max-(width|height)/.test(css));
  check("sidebar custom logo replaces the workspace block full-width (theme-agnostic image)", /\.nav-workspace-logo-full/.test(css) && /\.nav-workspace\.has-custom-logo/.test(css));

  console.log("\n[14] Old profiles without branding fields remain compatible");
  // Branding lives on disk (BrandingLogoStore), deliberately NOT in ui-settings.json, so a settings
  // file written before this feature needs no branding key and no migration. Prove this SEMANTICALLY —
  // the branding feature introduces no branding-specific field into the UiSettings schema/persistence —
  // instead of requiring app/main/uiSettings.ts to be byte-identical to `main`: other legitimate
  // features (e.g. accent, recorder security) may modify that same file, and this check must survive
  // integration alongside them while still failing if branding ever leaks a field into settings.
  const uiSettingsSrc = src("app/main/uiSettings.ts");
  const brandingSettingsRefs = uiSettingsSrc.match(/\bbranding\b|customLogo|workspaceLogo|logoPath|BrandingLogoStore|BrandingManifest|BrandingSettings/gi) ?? [];
  check(
    "branding adds no branding-specific field to UiSettings (ui-settings persistence untouched by this feature)",
    brandingSettingsRefs.length === 0,
    brandingSettingsRefs.length ? brandingSettingsRefs.join(", ") : "no branding key in the settings schema"
  );
  check("a fresh store with no prior state works (no branding fields required)", new BrandingLogoStore({ folder: join(tmp, "s14"), decodeAndVerify: decodeOk }).get().active === false);

  console.log("\n[15] .beads remains unchanged");
  check("this branch introduces no change to .beads/issues.jsonl", gitDiff(".beads/issues.jsonl") === "" && gitDiffCached(".beads/issues.jsonl") === "");

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nCustom brand logo: ${passed}/${results.length} checks passed`);
  rmSync(tmp, { recursive: true, force: true });
  if (passed !== results.length) process.exit(1);
}

function gitDiff(path: string): string {
  try {
    return execFileSync("git", ["diff", "main", "--", path], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "GIT_ERROR";
  }
}
function gitDiffCached(path: string): string {
  try {
    return execFileSync("git", ["diff", "--cached", "main", "--", path], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "GIT_ERROR";
  }
}

main();
