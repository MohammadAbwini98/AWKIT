/**
 * prepare-ocr-lab-fonts — Phase N, N7.6 (awkit-vra.9.7): stage the OCR Lab's bundled font into mock-site/public/fonts.
 *
 * Source: the owner-installed, lockfile-pinned mock-site/fonts-src (@fontsource/noto-sans 5.3.0, SIL Open Font License
 * 1.1). Nothing is downloaded. The staging is refused unless:
 *   - the installed package is exactly 5.3.0 and the lockfile records exactly the pinned registry integrity;
 *   - the package licence is OFL-1.1 and its LICENSE file is the SIL Open Font License text;
 *   - each of the three faces the lab loads (Latin, Greek and Cyrillic subsets, 400 normal) exists.
 * It writes the faces, the licence (OFL.txt) and fonts-manifest.json with each file's SHA-256 and size, so
 * benchmark:ocr can bind every calibration session to the exact bytes it rendered with.
 *
 * Run (after the owner install): node scripts/prepare-ocr-lab-fonts.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "mock-site", "fonts-src");
const pkgDir = path.join(source, "node_modules", "@fontsource", "noto-sans");
const out = path.join(root, "mock-site", "public", "fonts");

/** The registry metadata read 2026-10-27 for @fontsource/noto-sans 5.3.0 (license OFL-1.1). */
const PIN = {
  name: "@fontsource/noto-sans",
  version: "5.3.0",
  integrity: "sha512-fBCog2PY7DiVVTEEqtI/Qdinx/knobHYfoGpjFXdfBX5RoJaBp1Prw2G75p0OIsdlMZg3cLo0c+YbIUYOxnQJw==",
  license: "OFL-1.1",
  faces: ["noto-sans-latin-400-normal.woff2", "noto-sans-greek-400-normal.woff2", "noto-sans-cyrillic-400-normal.woff2"]
};

function refuse(message) {
  console.error(`prepare-ocr-lab-fonts REFUSED: ${message}`);
  process.exit(1);
}

if (!existsSync(pkgDir)) refuse(`${path.relative(root, pkgDir)} is not installed (owner: npm install --prefix mock-site/fonts-src --ignore-scripts --no-audit --no-fund)`);
const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
if (pkg.name !== PIN.name || pkg.version !== PIN.version) refuse(`installed ${pkg.name}@${pkg.version}, pinned ${PIN.name}@${PIN.version}`);
if (pkg.license !== PIN.license) refuse(`licence ${pkg.license}, pinned ${PIN.license}`);
const lockPath = path.join(source, "package-lock.json");
if (!existsSync(lockPath)) refuse("mock-site/fonts-src/package-lock.json is missing: the install is not lockfile-pinned");
const locked = JSON.parse(readFileSync(lockPath, "utf8")).packages?.[`node_modules/${PIN.name}`];
if (!locked || locked.version !== PIN.version || locked.integrity !== PIN.integrity) {
  refuse(`the lockfile entry for ${PIN.name} is ${locked?.version ?? "absent"} with integrity ${locked?.integrity ?? "absent"}, not the pinned registry integrity`);
}
const licencePath = ["LICENSE", "LICENSE.md", "OFL.txt"].map((name) => path.join(pkgDir, name)).find((p) => existsSync(p));
if (!licencePath) refuse("the package ships no LICENSE file");
const licence = readFileSync(licencePath, "utf8");
if (!/SIL OPEN FONT LICENSE/i.test(licence)) refuse(`${path.basename(licencePath)} is not the SIL Open Font License text`);

mkdirSync(out, { recursive: true });
const files = [];
for (const face of PIN.faces) {
  const from = path.join(pkgDir, "files", face);
  if (!existsSync(from)) refuse(`the face files/${face} is missing from the package`);
  const bytes = readFileSync(from);
  writeFileSync(path.join(out, face), bytes);
  files.push({ file: face, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const licenceBytes = Buffer.from(licence, "utf8");
writeFileSync(path.join(out, "ofl.txt"), licenceBytes);
files.push({ file: "ofl.txt", bytes: licenceBytes.length, sha256: createHash("sha256").update(licenceBytes).digest("hex") });
const manifest = {
  version: 1,
  family: "AwkitOcrLab",
  source: { package: PIN.name, version: PIN.version, integrity: PIN.integrity, license: PIN.license },
  files
};
writeFileSync(path.join(out, "fonts-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`prepare-ocr-lab-fonts: staged ${files.length} files into mock-site/public/fonts`);
for (const f of files) console.log(`  ${f.file} ${f.bytes} bytes sha256 ${f.sha256}`);
