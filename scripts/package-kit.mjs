// npm run package:kit — assemble dist/SpecterStudio <version> Kit for INTERNAL machines: the portable EXE
// plus the external components the app loads through Settings (Java runtime, Oracle JDBC driver, local AI
// model), an install guide with download sources, and SHA-256 sums.
//
// Run after package:portable. Sources default to this workstation and can be overridden:
//   AWKIT_KIT_JDK            JDK/JRE folder              (default C:\Program Files\Java\jdk-17)
//   AWKIT_KIT_DRIVER_BUNDLE  driver-store bundle id      (default: newest valid bundle)
//   AWKIT_KIT_MODEL          GGUF model file             (default %USERPROFILE%\Downloads\Qwen3.5-0.8B-Q4_K_M.gguf)
//
// The license issuer private key never enters the kit: an issuer-key source is refused, and the finished
// folder is scanned for key material and deleted if any is found. Licenses are issued per machine.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY_MATERIAL = /issuer|\.pkcs8|\.ed25519/i;
const MARKER = ".specterstudio-kit";

function fail(message) {
  console.error(`[FAIL]  ${message}`);
  process.exit(1);
}
function step(message) {
  console.log(`[STEP]  ${message}`);
}
function refuseKeyMaterial(path) {
  if (KEY_MATERIAL.test(path)) fail(`refusing a source that looks like issuer key material: ${path}`);
}
const sha256 = (file) =>
  new Promise((done, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", () => done(hash.digest("hex")));
  });
const mib = (bytes) => `${(bytes / 1048576).toFixed(bytes >= 1048576 * 10 ? 0 : 1)} MiB`;
// Manual walk: recursive readdirSync needs Node 18.17+, and this repository runs on 18.16.
function walk(folder, out = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const full = join(folder, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function folderStats(folder) {
  const files = walk(folder);
  return { files: files.length, bytes: files.reduce((sum, file) => sum + statSync(file).size, 0) };
}

const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
const exe = join(ROOT, "dist", `SpecterStudio ${version}.exe`);
const kit = join(ROOT, "dist", `SpecterStudio ${version} Kit`);
const runtimeRoot = join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "SpecterStudio");
const jdkSource = process.env.AWKIT_KIT_JDK || "C:\\Program Files\\Java\\jdk-17";
const modelSource = process.env.AWKIT_KIT_MODEL || join(homedir(), "Downloads", "Qwen3.5-0.8B-Q4_K_M.gguf");
const driverStore = join(runtimeRoot, "oracle-drivers");

// ── Validate every source before touching dist ──────────────────────────────────────────────────
step(`Checking sources for SpecterStudio ${version}`);
if (!existsSync(exe)) fail(`${relative(ROOT, exe)} is missing; run npm run package:portable first`);

refuseKeyMaterial(jdkSource);
const jdkRelease = join(jdkSource, "release");
if (!existsSync(join(jdkSource, "bin", "java.exe")) || !existsSync(jdkRelease)) fail(`no Java runtime with bin\\java.exe and a release file at ${jdkSource}`);
const releaseFields = Object.fromEntries(
  readFileSync(jdkRelease, "utf8")
    .split(/\r?\n/)
    .map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line))
    .filter(Boolean)
    .map((match) => [match[1], match[2]])
);
const javaVersion = releaseFields.JAVA_VERSION ?? "unknown";
const javaVendor = releaseFields.IMPLEMENTOR ?? "unknown vendor";
const javaMajor = javaVersion.startsWith("1.") ? Number(javaVersion.split(".")[1]) : Number.parseInt(javaVersion, 10);

if (!existsSync(driverStore)) fail(`no Oracle driver store at ${driverStore}; import a driver in Settings first`);
const bundles = readdirSync(driverStore, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    try {
      return { dir: join(driverStore, entry.name), manifest: JSON.parse(readFileSync(join(driverStore, entry.name, "manifest.json"), "utf8")) };
    } catch {
      return null;
    }
  })
  .filter((bundle) => bundle && bundle.manifest.validationStatus === "valid")
  .sort((a, b) => String(b.manifest.importedAt).localeCompare(String(a.manifest.importedAt)));
const wanted = process.env.AWKIT_KIT_DRIVER_BUNDLE;
const bundle = wanted ? bundles.find((candidate) => candidate.manifest.id === wanted) : bundles[0];
if (!bundle) fail(wanted ? `no valid driver bundle "${wanted}" in ${driverStore}` : `no valid driver bundle in ${driverStore}`);
const driverJars = [bundle.manifest.jdbcJar, ...(bundle.manifest.companionJars ?? [])];
for (const jar of driverJars) {
  const file = join(bundle.dir, jar);
  refuseKeyMaterial(file);
  if (!existsSync(file)) fail(`driver bundle ${bundle.manifest.id} lists ${jar}, which is missing`);
  const expected = String(bundle.manifest.checksums?.[jar] ?? "").replace(/^sha256:/, "");
  const actual = await sha256(file);
  if (!expected || expected !== actual) fail(`${jar} does not match its store manifest checksum`);
}
if (Number.isFinite(bundle.manifest.requiredJavaMajor) && javaMajor < bundle.manifest.requiredJavaMajor) {
  fail(`ojdbc needs Java ${bundle.manifest.requiredJavaMajor}+, the selected runtime is ${javaVersion}`);
}

refuseKeyMaterial(modelSource);
if (!existsSync(modelSource)) fail(`no model at ${modelSource}`);
{
  const handle = openSync(modelSource, "r");
  const magic = Buffer.alloc(4);
  readSync(handle, magic, 0, 4, 0);
  closeSync(handle);
  if (magic.toString("latin1") !== "GGUF") fail(`${modelSource} is not a GGUF model file`);
}

// ── Assemble ───────────────────────────────────────────────────────────────────────────────────
if (existsSync(kit)) {
  if (!existsSync(join(kit, MARKER))) fail(`${relative(ROOT, kit)} exists and was not made by this script; move it aside first`);
  step("Replacing the previous kit");
  rmSync(kit, { recursive: true, force: true });
}
mkdirSync(kit, { recursive: true });
writeFileSync(join(kit, MARKER), "");

step("Copying the portable EXE");
const exeName = basename(exe);
copyFileSync(exe, join(kit, exeName));

step(`Copying the Java runtime (${javaVendor} ${javaVersion})`);
const jdkName = basename(jdkSource);
cpSync(jdkSource, join(kit, "java", jdkName), { recursive: true });

step(`Copying the Oracle JDBC driver (${bundle.manifest.jdbcVersion ?? "unknown version"})`);
mkdirSync(join(kit, "oracle-jdbc"), { recursive: true });
for (const jar of driverJars) copyFileSync(join(bundle.dir, jar), join(kit, "oracle-jdbc", jar));

step("Copying the local AI model");
const modelName = basename(modelSource);
mkdirSync(join(kit, "ai-model"), { recursive: true });
copyFileSync(modelSource, join(kit, "ai-model", modelName));

// ── Key-material scan of the finished folder ────────────────────────────────────────────────────
const leaked = walk(kit)
  .filter((file) => KEY_MATERIAL.test(basename(file)))
  .map((file) => relative(kit, file));
if (leaked.length) {
  rmSync(kit, { recursive: true, force: true });
  fail(`key-like files found, kit deleted: ${leaked.join(", ")}`);
}

// ── Sums and guide ─────────────────────────────────────────────────────────────────────────────
step("Hashing");
const hashed = [exeName, ...driverJars.map((jar) => `oracle-jdbc/${jar}`), `ai-model/${modelName}`];
const sums = [];
for (const file of hashed) sums.push({ file, hash: await sha256(join(kit, file)), bytes: statSync(join(kit, file)).size });
writeFileSync(join(kit, "SHA256SUMS.txt"), sums.map(({ hash, file }) => `${hash} *${file.replaceAll("/", "\\")}`).join("\r\n") + "\r\n");
const jdkStats = folderStats(join(kit, "java", jdkName));
// The EXE's own source commit comes from package:portable's provenance, trusted only when that record
// describes this exact file.
const exeHash = sums.find((entry) => entry.file === exeName).hash;
let exeCommit = "unknown";
try {
  const provenance = JSON.parse(readFileSync(join(ROOT, "dist", "release-provenance.json"), "utf8"));
  if (provenance.artifacts?.portable?.sha256 === exeHash) {
    exeCommit = `${String(provenance.source?.commit ?? "").slice(0, 8)}${provenance.source?.treeDirty === false ? ", clean tree" : ", dirty tree"}`;
  }
} catch {
  // No provenance: the guide says the source commit is unknown.
}
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
} catch {
  // A kit built outside a checkout still gets a guide.
}
const sizeOf = (file) => mib(sums.find((entry) => entry.file === file).bytes);
const driverFile = `oracle-jdbc\\${bundle.manifest.jdbcJar}`;

const guide = `# SpecterStudio ${version}: internal install kit

Everything a Windows machine needs to run SpecterStudio ${version} with Oracle database access and local AI,
in one folder. For internal machines only. The EXE was built from commit \`${exeCommit}\`; this kit was
assembled at \`${commit}\` on ${new Date().toISOString().slice(0, 10)}.

| Item | What it is | Version | Size |
|---|---|---|---|
| \`${exeName}\` | The app (portable, no installer, no admin rights) | ${version} | ${sizeOf(exeName)} |
| \`java\\${jdkName}\\\` | Java runtime for the Oracle database bridge | ${javaVendor} ${javaVersion} | ${mib(jdkStats.bytes)} (${jdkStats.files} files) |
| \`${driverFile}\` | Oracle JDBC driver | ${bundle.manifest.jdbcVersion ?? "see jar"} | ${sizeOf(`oracle-jdbc/${bundle.manifest.jdbcJar}`)} |
| \`ai-model\\${modelName}\` | Local AI model (runs on CPU) | GGUF | ${sizeOf(`ai-model/${modelName}`)} |
| \`SHA256SUMS.txt\` | Checksums of the files above | | |

## Before you start

- Windows 10 or 11, 64-bit. No internet and no administrator rights are needed.
- Copy this whole folder to a permanent place first, for example \`C:\\SpecterStudio\`. The app remembers
  where the Java runtime is, so do not move the folder after step 3.

## 1. Start SpecterStudio

Run \`${exeName}\`. On first start, create the Super User account. The app keeps its data in
\`%LOCALAPPDATA%\\SpecterStudio\`, never inside this folder.

## 2. Activate the license

Open **Licensing** in the sidebar, choose **Export activation request** (or **Copy activation request**) and
send it to your license administrator. When the signed license comes back, choose **Import license**.
Licenses are issued per machine, so this kit contains none.

## 3. Add the Java runtime

**Settings > Integrations and intelligence > Java Runtime for Database Drivers.** Type a name such as
\`JDK ${javaMajor}\`, choose **Select JRE/JDK folder...** and pick \`java\\${jdkName}\` in this folder
(or **Select java.exe...** and pick \`java\\${jdkName}\\bin\\java.exe\`). Make sure it is the default runtime.

## 4. Import the Oracle JDBC driver

**Settings > Integrations and intelligence > Oracle JDBC Drivers.** Type a bundle name such as
\`ojdbc ${bundle.manifest.jdbcVersion ?? ""}\`, choose **Import driver bundle...** and pick
\`${driverFile}\`. The app copies the driver into its own store and validates it with the Java runtime
from step 3. This driver needs Java ${bundle.manifest.requiredJavaMajor ?? 8} or newer.

## 5. Import the local AI model (optional)

**Settings > Integrations and intelligence > Local AI.** Choose **Import Model Pack...**, pick
\`ai-model\\${modelName}\` and confirm. Then turn Local AI on. This is the model SpecterStudio is qualified
with on CPU; no graphics card or GPU pack is required.

## Optional: Google Chrome

Only needed if a Super User switches the automation browser to **Installed Google Chrome**. The bundled
Chromium is the default and needs nothing.

## Check the files

\`\`\`
certutil -hashfile "${exeName}" SHA256
\`\`\`

Compare each result with \`SHA256SUMS.txt\`.

## Download sources

Use these to fetch a component again or to build a kit for another machine.

| Component | Where to get it |
|---|---|
| Java ${javaMajor} | Oracle JDK archive: https://www.oracle.com/java/technologies/javase/jdk${javaMajor}-archive-downloads.html. Eclipse Temurin (OpenJDK) also works: https://adoptium.net/temurin/releases/?version=${javaMajor} |
| Oracle JDBC driver | https://www.oracle.com/database/technologies/appdev/jdbc-downloads.html |
| Local AI model | https://huggingface.co/lmstudio-community/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf |
| Google Chrome (optional) | https://www.google.com/chrome/ |

Each component keeps its own license terms: the JDK's are in \`java\\${jdkName}\\legal\`, Oracle's driver
terms are on its download page, and the model's are on its model card.

## Already inside the EXE

Nothing to install for these: Chromium 149 for automation, Python 3.12 with Scrapling (DOM intelligence),
the local AI runtime (llama.cpp, CPU), the Zvec semantic index, the Visual C++ runtime and the Oracle
bridge.

## Not included, on purpose

- **The license issuer key.** It stays with the license administrator and is never distributed.
- **Licenses.** Each machine gets its own (step 2).
- **Your data.** Flows, workflows, sessions and settings live in each user's profile.
`;
writeFileSync(join(kit, "INSTALL.md"), guide);

const total = folderStats(kit);
console.log("");
console.log(`[OK]    ${relative(ROOT, kit)}`);
console.log(`        ${total.files} files, ${mib(total.bytes)}`);
for (const { file, hash, bytes } of sums) console.log(`        ${hash}  ${mib(bytes).padStart(9)}  ${file}`);
console.log(`        java/${jdkName}: ${javaVendor} ${javaVersion}, ${jdkStats.files} files, ${mib(jdkStats.bytes)}`);
