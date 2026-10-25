/**
 * verify:packaging-host — read-only diagnosis of whether THIS machine can run the governed portable packaging
 * pipeline (`npm run package:portable`), requirement by requirement. It installs, copies and changes nothing.
 *
 * Every requirement prints PASS, BLOCKED (a packaging prerequisite is missing; the remedy is printed) or INFO (a
 * fact the operator needs, not a gate). Exit 0 only when every gated requirement passes.
 *
 *  H1 Host OS and CPU (Windows; x64, or ARM64 running the x64 toolchain; the package target is Windows x64)
 *  H2 Node.js (version and architecture the build runs under)
 *  H3 Electron (the pinned version; INFO whether the win32-x64 archive electron-builder packs is cached locally)
 *  H4 Visual Studio 2022 Community, Professional or Enterprise with the two MSVC components (awkit-i6ot)
 *  H5 The app-local MSVC runtime: the three x64 DLLs from that installation's redist folder, Microsoft-signed, at least
 *     the 14.40 floor (the packaging step also raises it to the newest linker of a staged binary)
 *  H6 Drift guard: the shared requirements module still matches the values the packaging step enforces
 *  I1 Release-tree cleanliness for scripts/release-portable.ps1 (untracked files make it refuse)
 *  I2 License issuer key for the licensed packaged gates (presence only; the value is never read or printed)
 *
 * Run: npm run verify:packaging-host
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MSVC_REMEDY, MSVC_RUNTIME, MSVC_RUNTIME_FLOOR, VS_COMPONENTS, VS_PRODUCTS, VS_VERSION_RANGE } from "./lib/msvc-redist-requirements.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let blocked = 0;
const report = (id, state, label, detail) => {
  if (state === "BLOCKED") blocked += 1;
  console.log(`  ${state.padEnd(7)} ${id} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log("Packaging host diagnosis (read-only)\n");

// H1 Host OS and CPU.
// An x64 process on Windows ARM64 runs under emulation and sees PROCESSOR_ARCHITECTURE=AMD64, so the native CPU is
// read from the x64 emulator's presence (xtajit64.dll exists only on ARM64 Windows) and the CPU model.
const windir = process.env.SystemRoot || process.env.windir || "C:\\Windows";
const nativeArm64 =
  /arm64/i.test(process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || "") ||
  fs.existsSync(path.join(windir, "System32", "xtajit64.dll")) ||
  /\b(ARM|Snapdragon|Apple)\b/i.test(os.cpus()[0]?.model ?? "");
const hostArch = nativeArm64 ? "ARM64" : process.env.PROCESSOR_ARCHITEW6432 || process.env.PROCESSOR_ARCHITECTURE || os.arch();
if (process.platform !== "win32") report("H1", "BLOCKED", "Windows host", `this is ${process.platform}; portable packaging targets Windows x64 and must run on Windows`);
else
  report(
    "H1",
    "PASS",
    "Windows host",
    `${os.release()}, native CPU ${hostArch}, this process ${process.arch}${nativeArm64 ? " (ARM64: the x64 toolchain runs under emulation; packaging here needs the x64 MSVC components installed in Visual Studio 2022 on this ARM64 host, which no recorded release has yet proven, or a Windows x64 release host)" : ""}`
  );

// H2 Node.js.
const nodeMajor = Number(process.versions.node.split(".")[0]);
report("H2", nodeMajor >= 20 ? "PASS" : "BLOCKED", "Node.js", `${process.version} ${process.arch}${nodeMajor >= 20 ? "" : " (Node 20 or newer is required by the build toolchain)"}`);

// H3 Electron and its offline x64 archive.
let electronVersion = "";
try {
  electronVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules", "electron", "package.json"), "utf8")).version;
} catch {
  electronVersion = "";
}
const pinned = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).devDependencies?.electron ?? "";
report("H3a", electronVersion && electronVersion === pinned ? "PASS" : "BLOCKED", "Electron installed at the pinned version", `installed ${electronVersion || "none"}, pinned ${pinned || "none"}`);
const cacheDirs = [process.env.ELECTRON_CACHE, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "electron", "Cache")].filter(Boolean);
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
const cached = cacheDirs.flatMap((dir) => {
  try {
    return fs.readdirSync(dir, { recursive: true }).filter((entry) => String(entry).endsWith(zipName)).map((entry) => path.join(dir, String(entry)));
  } catch {
    return [];
  }
});
report(
  "H3b",
  "INFO",
  "win32-x64 Electron archive in the local cache",
  cached.length > 0
    ? cached[0]
    : `${zipName} not cached in ${cacheDirs.join(" or ") || "the Electron cache"}: electron-builder fetches the official Electron release and verifies its checksum, so a networked build host is fine; an offline build host needs it cached first`
);

// H4 Visual Studio 2022 with the MSVC components (same query as the packaging step).
const vswhere = path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
let install = "";
if (!fs.existsSync(vswhere)) {
  report("H4", "BLOCKED", "Visual Studio 2022 with the MSVC x64/x86 tools and redist", `vswhere.exe is absent (no Visual Studio installed); ${MSVC_REMEDY}`);
} else {
  const run = spawnSync(vswhere, ["-latest", "-version", VS_VERSION_RANGE, "-products", ...VS_PRODUCTS, "-requires", ...VS_COMPONENTS, "-property", "installationPath", "-utf8"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  install = `${run.stdout ?? ""}`.trim().split(/\r?\n/)[0] ?? "";
  if (run.status === 0 && install) report("H4", "PASS", "Visual Studio 2022 with the MSVC x64/x86 tools and redist", install);
  else {
    const any = spawnSync(vswhere, ["-all", "-products", "*", "-property", "displayName", "-utf8"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    const found = `${any.stdout ?? ""}`.trim().split(/\r?\n/).filter(Boolean);
    report("H4", "BLOCKED", "Visual Studio 2022 with the MSVC x64/x86 tools and redist", `installed: ${found.join(", ") || "none"}; none is a VS 2022 Community, Professional or Enterprise with ${VS_COMPONENTS.join(" and ")}; ${MSVC_REMEDY}`);
  }
}

// H5 The app-local runtime DLLs.
if (!install) {
  report("H5", "BLOCKED", `App-local MSVC runtime (${MSVC_RUNTIME.join(", ")})`, "needs H4 first");
} else {
  const versionFile = path.join(install, "VC", "Auxiliary", "Build", "Microsoft.VCRedistVersion.default.txt");
  const redistVersion = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").trim() : "";
  const archDir = path.join(install, "VC", "Redist", "MSVC", redistVersion, "x64");
  const crt = fs.existsSync(archDir) ? fs.readdirSync(archDir).filter((name) => /^Microsoft\.VC14\d\.CRT$/i.test(name)) : [];
  if (!/^14\.\d+\.\d+$/.test(redistVersion) || crt.length !== 1) {
    report("H5", "BLOCKED", "App-local MSVC runtime", `redist version "${redistVersion || "missing"}", ${crt.length} Microsoft.VC14x.CRT folder(s) in ${archDir}; ${MSVC_REMEDY}`);
  } else {
    const files = MSVC_RUNTIME.map((name) => path.join(archDir, crt[0], name));
    const list = files.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
    const probe = spawnSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", `foreach ($p in @(${list})) { if (Test-Path -LiteralPath $p) { $s = Get-AuthenticodeSignature -LiteralPath $p; $v = (Get-Item -LiteralPath $p).VersionInfo; "$($s.Status)|$($s.SignerCertificate.Subject)|$($v.FileMajorPart).$($v.FileMinorPart).$($v.FileBuildPart)" } else { "Missing||0.0.0" } }`],
      { encoding: "utf8", windowsHide: true, timeout: 60_000 }
    );
    const rows = `${probe.stdout ?? ""}`.trim().split(/\r?\n/);
    MSVC_RUNTIME.forEach((name, i) => {
      const [status = "Unread", subject = "", version = "0.0.0"] = (rows[i] ?? "").split("|");
      const v = version.split(".").map(Number);
      const newEnough = v[0] > MSVC_RUNTIME_FLOOR[0] || (v[0] === MSVC_RUNTIME_FLOOR[0] && v[1] >= MSVC_RUNTIME_FLOOR[1]);
      const ok = status === "Valid" && /O=Microsoft Corporation/.test(subject) && newEnough;
      report("H5", ok ? "PASS" : "BLOCKED", name, `${status}, ${subject.match(/CN=[^,]+/)?.[0] ?? "no signer"}, ${version} (floor ${MSVC_RUNTIME_FLOOR.join(".")}; the packaging step also requires the newest staged linker)`);
    });
  }
}

// H6 Drift guard against the packaging step's own source.
const prepare = fs.readFileSync(path.join(root, "scripts", "prepare-ai-native-host.mjs"), "utf8");
const enforced = [...MSVC_RUNTIME, ...VS_COMPONENTS, ...VS_PRODUCTS, VS_VERSION_RANGE, `[${MSVC_RUNTIME_FLOOR.join(", ")}]`].every((value) => prepare.includes(value));
report("H6", enforced ? "PASS" : "BLOCKED", "Requirements match the packaging step", enforced ? "every shared value appears in prepare-ai-native-host.mjs" : "scripts/lib/msvc-redist-requirements.mjs no longer matches prepare-ai-native-host.mjs; reconcile them before trusting this diagnosis");

// I1 Release-tree cleanliness (informational).
const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000 });
const changes = `${status.stdout ?? ""}`.trim().split(/\r?\n/).filter(Boolean);
report(
  "I1",
  "INFO",
  "Working tree for scripts/release-portable.ps1",
  changes.length === 0 ? "clean" : `${changes.length} change(s) or untracked file(s); release-portable.ps1 refuses them (a local .git/info/exclude entry keeps a preserved untracked file out of the check without touching it)`
);

// I2 Issuer key presence (informational; never read).
report("I2", "INFO", "Issuer key for the licensed packaged gates", process.env.AWKIT_PACKAGED_LICENSE_ISSUER_KEY ? "AWKIT_PACKAGED_LICENSE_ISSUER_KEY is set" : "not set: licensed packaged gates report BLOCKED");

console.log(`\nverify:packaging-host — ${blocked === 0 ? "READY: every packaging prerequisite is present" : `${blocked} prerequisite(s) BLOCKED`}`);
process.exit(blocked === 0 ? 0 : 1);
