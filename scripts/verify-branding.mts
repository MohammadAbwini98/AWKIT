// Deterministic unit checks for the custom workspace-logo model (src/branding/*) that backs the
// Super-User branding feature. No Electron / DOM — pure PNG validation, dimension bounds, the managed
// store's round-trip + corrupt/missing fallback + atomic-replace-preserves-old behavior, and the
// permission wiring. Real (decodable) PNGs are synthesized with node:zlib so no image dependency is
// needed.
//
// Run: npx tsx scripts/verify-branding.mts
import { deflateSync } from "node:zlib";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  BRANDING_ACCEPTED_INPUT_EXTENSIONS,
  BRANDING_ACCEPTED_INPUT_MIME,
  BRANDING_MAX_BYTES,
  BRANDING_MAX_DIMENSION,
  BRANDING_MIN_DIMENSION,
  checkPngBytes,
  hasPngSignature,
  isDimensionInRange,
  readPngDimensions
} from "../src/branding/BrandingValidation";
import { BrandingLogoStore } from "../src/branding/BrandingLogoStore";
import { ALL_PERMISSIONS, BUILTIN_ROLES, Permission, SENSITIVE_PERMISSIONS } from "../src/security/authz/Permissions";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Minimal valid PNG generator (8-bit RGBA, single solid frame) ──────────────
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((1 + width * 4) * height, 0); // filter byte 0 per row + transparent pixels
  const idat = deflateSync(raw);
  return new Uint8Array(Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]));
}
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// ── 1. Signature + dimension parsing (real decode, not extension) ─────────────
check("PNG signature accepted on a real PNG", hasPngSignature(makePng(64, 64)));
check("PNG signature rejected on JPEG bytes", !hasPngSignature(JPEG_BYTES));
check("PNG signature rejected on short buffer", !hasPngSignature(new Uint8Array([0x89, 0x50])));
const dims = readPngDimensions(makePng(120, 80));
check("readPngDimensions reads IHDR width/height", dims?.width === 120 && dims?.height === 80, JSON.stringify(dims));
check("readPngDimensions returns null for non-PNG", readPngDimensions(JPEG_BYTES) === null);

check("dimension 32 in range (min)", isDimensionInRange(BRANDING_MIN_DIMENSION));
check("dimension 2048 in range (max)", isDimensionInRange(BRANDING_MAX_DIMENSION));
check("dimension 31 out of range", !isDimensionInRange(31));
check("dimension 2049 out of range", !isDimensionInRange(2049));

// ── 2. checkPngBytes structural gate ─────────────────────────────────────────
check("checkPngBytes accepts a valid in-range PNG", checkPngBytes(makePng(64, 64)).ok);
check("checkPngBytes rejects empty", reason(checkPngBytes(new Uint8Array(0))) === "empty");
check("checkPngBytes rejects >5MB before anything else", reason(checkPngBytes(new Uint8Array(BRANDING_MAX_BYTES + 1))) === "too-large");
check("checkPngBytes rejects non-PNG (renamed/forged) as not-png", reason(checkPngBytes(JPEG_BYTES)) === "not-png");
check("checkPngBytes rejects too-small dimensions", reason(checkPngBytes(makePng(20, 20))) === "dimensions-out-of-range");
check("checkPngBytes rejects too-large dimensions", reason(checkPngBytes(makePng(3000, 3000))) === "dimensions-out-of-range");

// Accepted input formats (the renderer rasterizes SVG to PNG at import; main only ever stores PNG).
check("SVG is an accepted input format", BRANDING_ACCEPTED_INPUT_MIME.includes("image/svg+xml") && BRANDING_ACCEPTED_INPUT_EXTENSIONS.includes(".svg"));
check("raster formats remain accepted", ["image/png", "image/jpeg", "image/webp"].every((m) => BRANDING_ACCEPTED_INPUT_MIME.includes(m)));

// ── 3. Managed store round-trip (no injected decode) ─────────────────────────
const dir = mkdtempSync(join(tmpdir(), "awkit-branding-"));
try {
  const store = new BrandingLogoStore({ folder: join(dir, "s1") });
  check("fresh store → active:false", store.get().active === false);

  const a = makePng(64, 48);
  const put = await store.replace(a, { updatedByUserId: "u-1" });
  check("replace(valid PNG) → ok", put.ok === true, put.ok ? "" : (put as { reason: string }).reason);
  if (put.ok) {
    check("manifest records IHDR dimensions", put.manifest.width === 64 && put.manifest.height === 48);
    check("manifest records the acting user (no source path)", put.manifest.updatedByUserId === "u-1" && !("path" in put.manifest) && !("fileName" in put.manifest));
  }
  const state = store.get();
  check("get() after replace → active with manifest", state.active === true && state.manifest?.width === 64);
  const bytes = store.readActiveBytes();
  check("readActiveBytes round-trips the stored PNG", !!bytes && sha256(bytes) === sha256(a));
  check("only the active/ dir remains (staging/backups cleaned up)", readdirSync(join(dir, "s1")).sort().join(",") === "active");

  // 4. Fallback on tamper / corruption / missing.
  writeFileSync(join(dir, "s1", "active", "logo.png"), Buffer.from(makePng(64, 48)).subarray(0, 40)); // truncate → hash mismatch
  check("tampered logo → get() falls back to active:false (hash mismatch)", store.get().active === false);
  await store.replace(makePng(64, 48)); // restore
  writeFileSync(join(dir, "s1", "active", "manifest.json"), "{ this is not json");
  check("corrupt manifest → get() falls back to active:false", store.get().active === false);
  await store.replace(makePng(64, 48)); // restore
  writeFileSync(join(dir, "s1", "active", "logo.png"), Buffer.from(JPEG_BYTES)); // non-PNG content
  check("non-PNG logo content → get() falls back to active:false", store.get().active === false);

  // 5. Replace validation failures.
  const store2 = new BrandingLogoStore({ folder: join(dir, "s2") });
  check("replace(too small) → rejected", reason(await store2.replace(makePng(20, 20))) === "dimensions-out-of-range");
  check("replace(too large) → rejected", reason(await store2.replace(makePng(3000, 3000))) === "dimensions-out-of-range");
  check("replace(JPEG bytes) → rejected not-png", reason(await store2.replace(JPEG_BYTES)) === "not-png");
  check("replace(empty) → rejected empty", reason(await store2.replace(new Uint8Array(0))) === "empty");

  // 6. Failed replace preserves the previously-active logo.
  const store3 = new BrandingLogoStore({ folder: join(dir, "s3") });
  const first = makePng(64, 64);
  await store3.replace(first);
  const firstSha = sha256(store3.readActiveBytes()!);
  const bad = await store3.replace(JPEG_BYTES);
  check("failed replace returns ok:false", bad.ok === false);
  check("failed replace preserves the previous logo unchanged", store3.get().active === true && sha256(store3.readActiveBytes()!) === firstSha);

  // 7. Successful replace fully swaps the asset (atomic).
  await store3.replace(makePng(100, 50));
  const swapped = store3.get();
  check("successful replace swaps to the new asset", swapped.active === true && swapped.manifest?.width === 100 && swapped.manifest?.height === 50);
  check("swap leaves no leftover staging/backup dirs", readdirSync(join(dir, "s3")).sort().join(",") === "active");

  // 8. remove() restores the default (active:false).
  store3.remove();
  check("remove() → active:false", store3.get().active === false);
  store3.remove(); // idempotent
  check("remove() is idempotent", store3.get().active === false);

  // 9. Injected real-decode gate (main process nativeImage stand-in).
  const rejectFolder = join(dir, "s4");
  await new BrandingLogoStore({ folder: rejectFolder }).replace(makePng(64, 64)); // write a structurally valid logo
  const nullDecode = new BrandingLogoStore({ folder: rejectFolder, decodeAndVerify: () => null });
  check("get() rejects when the injected decode fails (corrupt pixels)", nullDecode.get().active === false);
  check("replace() rejects when the injected decode fails", reason(await new BrandingLogoStore({ folder: join(dir, "s5"), decodeAndVerify: () => null }).replace(makePng(64, 64))) === "decode-failed");
  const okDecode = new BrandingLogoStore({ folder: join(dir, "s6"), decodeAndVerify: (b) => readPngDimensions(b) });
  check("replace()+get() pass when the injected decode succeeds", (await okDecode.replace(makePng(64, 64))).ok === true && okDecode.get().active === true);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ── 10. Permission wiring ─────────────────────────────────────────────────────
check("SETTINGS_BRANDING_MANAGE has the documented id", Permission.SETTINGS_BRANDING_MANAGE === "settings.appearance.branding.manage");
check("branding permission is marked sensitive", SENSITIVE_PERMISSIONS.has(Permission.SETTINGS_BRANDING_MANAGE));
check("SuperUser holds the branding permission", BUILTIN_ROLES.SuperUser.permissions.includes(Permission.SETTINGS_BRANDING_MANAGE));
check("SuperUser holds every permission (sanity)", ALL_PERMISSIONS.every((p) => BUILTIN_ROLES.SuperUser.permissions.includes(p)));
check("Administrator does NOT hold the branding permission", !BUILTIN_ROLES.Administrator.permissions.includes(Permission.SETTINGS_BRANDING_MANAGE));
check("Operator does NOT hold the branding permission", !BUILTIN_ROLES.Operator.permissions.includes(Permission.SETTINGS_BRANDING_MANAGE));
check("Viewer does NOT hold the branding permission", !BUILTIN_ROLES.Viewer.permissions.includes(Permission.SETTINGS_BRANDING_MANAGE));

function reason(r: { ok: true } | { ok: false; reason: string }): string {
  return r.ok ? "ok" : r.reason;
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nBranding model: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
