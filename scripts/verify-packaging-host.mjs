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
 *  H3c electron-builder's build tools (winCodeSign, nsis, nsis-resources): each candidate archive from --tool-archives
 *      (default %LOCALAPPDATA%\SpecterStudio\release-inputs\electron-builder-tools) hashed against the SHA-512 the installed toolchain embeds, and the app-builder cache folder compared file by file
 *      with a verified archive; never acquires, copies or extracts anything
 *  H4 Visual Studio 2022 Community, Professional or Enterprise with the two MSVC components (awkit-i6ot)
 *  H5 The app-local MSVC runtime: the three x64 DLLs from that installation's redist folder, Microsoft-signed, at least
 *     the 14.40 floor (the packaging step also raises it to the newest linker of a staged binary)
 *  H6 Declaration-level drift guard: the packaging step's own declarations (runtime DLLs, floor, vswhere components,
 *     products and version range) equal the shared module's, with source mutations that must each be caught. It does
 *     not prove behavioral equivalence.
 *  I1 Release-tree cleanliness for scripts/release-portable.ps1 (untracked files make it refuse)
 *  I2 License issuer key for the licensed packaged gates (presence only; the value is never read or printed)
 *
 * Run: npm run verify:packaging-host [-- --tool-archives <folder>] [--builder-cache <folder>]
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

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
// H3c also needs zlib.crc32 (Node 20.15+ or 22.2+), so an older Node 20 is BLOCKED rather than crashing mid-check.
const nodeMajor = Number(process.versions.node.split(".")[0]);
const nodeOk = nodeMajor >= 20 && typeof zlib.crc32 === "function";
report("H2", nodeOk ? "PASS" : "BLOCKED", "Node.js", `${process.version} ${process.arch}${nodeOk ? "" : " (Node 20.15+ or 22.2+ is required: the build toolchain needs Node 20, and H3c needs zlib.crc32)"}`);

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

// H3c electron-builder's own build tools (read-only; acquires, copies, extracts and changes nothing).
// electron-builder 25.1.8 hands these downloads to app-builder.exe (app-builder-bin 5.0.0-alpha.10). It keeps only the
// EXTRACTED folder, at <cache>\<name up to the first "-">\<name>-<version> (cache = ELECTRON_BUILDER_CACHE, else
// %LOCALAPPDATA%\electron-builder\Cache), and reuses an existing folder WITHOUT re-checking it. So an archive counts as
// verified only when its SHA-512 equals the value the installed toolchain embeds, and a cache folder only when its files
// equal a verified archive's listing (per-file size and CRC32 from the bundled 7za). Candidate archives come from
// --tool-archives <folder> (repeatable). Statuses: PRESENT AND VERIFIED, MISSING, CHECKSUM MISMATCH, VERSION MISMATCH,
// INVALID CACHE LAYOUT, INCONCLUSIVE.
const TOOL_PINS = [
  { name: "winCodeSign", version: "2.6.0", sha512: "6LQI2d9BPC3Xs0ZoTQe1o3tPiA28c7+PY69Q9i/pD8lY45psMtHuLwv3vRckiVr3Zx1cbNyLlBR8STwCdcHwtA==" },
  { name: "nsis", version: "3.0.4.1", sha512: "VKMiizYdmNdJOWpRGz4trl4lD++BvYP2irAXpMilheUP0pc93iKlWAoP843Vlraj8YG19CVn0j+dCo/hURz9+Q==" },
  { name: "nsis-resources", version: "3.4.1", sha512: "Dqd6g+2buwwvoG1Vyf6BHR1b+25QMmPcwZx40atOT57gH27rkjOei1L0JTldxZu4NFoEmW4kJgZ3DlSWVON3+Q==" }
];
// The ONLY archive entries allowed to be absent from a cache folder: macOS-only symbolic links that Windows cannot
// create without the symlink privilege and that Windows packaging never reads (the real libraries beside them,
// libcrypto.1.0.0.dylib and libssl.1.0.0.dylib, are regular files and are compared). An entry is tolerated only when the
// verified archive's own listing marks it as a link AND it is named here; scripts/release-provision-electron-builder-tools.ps1
// excludes exactly these entries from extraction.
const MACOS_ONLY_LINKS = {
  "winCodeSign-2.6.0": ["darwin/10.12/lib/libcrypto.dylib", "darwin/10.12/lib/libssl.dylib"]
};
// Without --tool-archives, the operator's staging folder %LOCALAPPDATA%\SpecterStudio\release-inputs\electron-builder-tools
// is searched (outside Git, resources and app.asar, beside the release-keys custody folder), when it exists.
const toolArchiveArgs = process.argv.flatMap((arg, i, all) => (arg === "--tool-archives" && all[i + 1] ? [path.resolve(all[i + 1])] : []));
const stagingDir = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "SpecterStudio", "release-inputs", "electron-builder-tools") : "";
const toolArchiveDirs = toolArchiveArgs.length > 0 ? toolArchiveArgs : stagingDir && fs.existsSync(stagingDir) ? [stagingDir] : [];
const readOr = (file, encoding, fallback) => {
  try {
    return fs.readFileSync(file, encoding);
  } catch {
    return fallback;
  }
};
const libOut = path.join(root, "node_modules", "app-builder-lib", "out");
const appBuilderExe = path.join(root, "node_modules", "app-builder-bin", "win", process.arch, "app-builder.exe");
const appBuilderText = readOr(appBuilderExe, "latin1", "");
const jsPin = (file, name) => {
  const all = [...readOr(path.join(libOut, ...file), "utf8", "").matchAll(new RegExp(`getBinFromUrl\\)\\("${name}", "([^"]+)", "([A-Za-z0-9+/]{86}==)"\\)`, "g"))];
  return all.length === 1 ? { version: all[0][1], sha512: all[0][2] } : null;
};
// What the INSTALLED toolchain resolves for each tool: nsis and nsis-resources pass version and SHA-512 from the JS;
// winCodeSign is requested by name only, so app-builder.exe supplies both (its 2.6.0 checksum must be embedded verbatim).
const installedPin = {
  winCodeSign:
    /getBin\)\("winCodeSign"\)/.test(readOr(path.join(libOut, "codeSign", "windowsSignToolManager.js"), "utf8", "")) && appBuilderText.includes(TOOL_PINS[0].sha512)
      ? { version: TOOL_PINS[0].version, sha512: TOOL_PINS[0].sha512 }
      : null,
  nsis: jsPin(["targets", "nsis", "nsisUtil.js"], "nsis"),
  "nsis-resources": jsPin(["targets", "nsis", "NsisTarget.js"], "nsis-resources")
};
// --builder-cache <folder> inspects another cache folder (for example one offered for reuse) instead of the one this
// host's packaging run would read; the report names the folder either way.
const cacheArg = process.argv.indexOf("--builder-cache");
const builderCache =
  cacheArg > 0 && process.argv[cacheArg + 1]
    ? path.resolve(process.argv[cacheArg + 1])
    : process.env.ELECTRON_BUILDER_CACHE || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "electron-builder", "Cache") : "");
const sevenZip = path.join(root, "node_modules", "7zip-bin", "win", process.arch, "7za.exe");
const listArchive = (archive) => {
  const run = spawnSync(sevenZip, ["l", "-slt", archive], { encoding: "utf8", windowsHide: true, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  const body = `${run.stdout ?? ""}`.split(/\r?\n----------\r?\n/)[1];
  if (run.status !== 0 || !body) return null;
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => Object.fromEntries([...block.matchAll(/^(\w[\w ]*?) = (.*)$/gm)].map((m) => [m[1], m[2]])))
    .filter((entry) => entry.Path)
    .map((entry) => {
      // Attributes = "<Windows letters>[ <unix mode>]", for example "A_ -rw-r--r--", "D_ drwxr-xr-x", "A_ lrwxr-xr-x".
      const [win = "", unix = ""] = (entry.Attributes ?? "").split(" ");
      return { rel: entry.Path.replace(/\\/g, "/"), dir: /D/.test(win) || unix.startsWith("d") || entry.Folder === "+", link: /^l[rwxsStT-]{9}$/.test(unix), size: Number(entry.Size ?? 0), crc: (entry.CRC ?? "").toUpperCase() };
    });
};
// The H3c inventory criteria, shared by the real comparison and the negative controls: every archive file present as a
// regular (non-link) file with equal size and CRC32; nothing on disk that the archive lacks; no symbolic link or junction
// anywhere on disk (a reparse point could redirect a checked file or hide content); and the archive's link entries must be
// ABSENT, which is tolerated only for this tool's pinned macOS-only links. onDisk is [{ rel, link }] for every file and
// link under the folder; inspect(rel) is lstat-based and returns null or { isFile, link, size, crc: () => "HEX" }.
function compareInventory(id, listing, onDisk, inspect) {
  const files = listing.filter((entry) => !entry.dir);
  const expected = new Set(files.map((entry) => entry.rel.toLowerCase()));
  const tolerated = new Set((MACOS_ONLY_LINKS[id] ?? []).map((rel) => rel.toLowerCase()));
  let differ = 0;
  let linksAbsent = 0;
  for (const entry of files) {
    const found = inspect(entry.rel);
    if (entry.link) {
      if (!found && tolerated.has(entry.rel.toLowerCase())) linksAbsent += 1;
      else differ += 1; // an unpinned link entry, or any content at a link path, is not accepted
    } else if (!found || !found.isFile || found.link || found.size !== entry.size || (entry.size > 0 && found.crc() !== entry.crc)) differ += 1;
  }
  const extra = onDisk.filter((item) => item.link || !expected.has(item.rel.toLowerCase())).length;
  return { files: files.length, differ, extra, linksAbsent, ok: differ === 0 && extra === 0 };
}
// Negative controls: each mutation of a matching synthetic inventory must be rejected, so the comparison cannot pass
// vacuously or tolerate more than the pinned links.
{
  const listing = [
    { rel: "bin", dir: true, link: false, size: 0, crc: "" },
    { rel: "bin/tool.exe", dir: false, link: false, size: 4, crc: "0000ABCD" },
    { rel: "darwin/10.12/lib/libssl.dylib", dir: false, link: true, size: 20, crc: "0000BEEF" }
  ];
  const disk = { "bin/tool.exe": { isFile: true, link: false, size: 4, crc: "0000ABCD" } };
  const check = (id, list, files) =>
    compareInventory(
      id,
      list,
      Object.entries(files).map(([rel, item]) => ({ rel, link: item.link })),
      (rel) => (files[rel] ? { ...files[rel], crc: () => files[rel].crc } : null)
    ).ok;
  const unlinked = listing.map((entry) => (entry.link ? { ...entry, link: false } : entry));
  const mutations = {
    "a pinned link path present on disk as a file": check("winCodeSign-2.6.0", listing, { ...disk, "darwin/10.12/lib/libssl.dylib": { isFile: true, link: false, size: 20, crc: "0000BEEF" } }),
    "a Windows file replaced by a symbolic link": check("winCodeSign-2.6.0", listing, { "bin/tool.exe": { ...disk["bin/tool.exe"], isFile: false, link: true } }),
    "a junction or link inside the folder": check("winCodeSign-2.6.0", listing, { ...disk, "bin/elsewhere": { isFile: false, link: true, size: 0, crc: "" } }),
    "a Windows file missing": check("winCodeSign-2.6.0", listing, {}),
    "a size differs": check("winCodeSign-2.6.0", listing, { "bin/tool.exe": { ...disk["bin/tool.exe"], size: 5 } }),
    "a CRC32 differs": check("winCodeSign-2.6.0", listing, { "bin/tool.exe": { ...disk["bin/tool.exe"], crc: "0000ABCE" } }),
    "a folder where a file belongs": check("winCodeSign-2.6.0", listing, { "bin/tool.exe": { ...disk["bin/tool.exe"], isFile: false } }),
    "an extra file": check("winCodeSign-2.6.0", listing, { ...disk, "bin/extra.dll": { isFile: true, link: false, size: 1, crc: "00000001" } }),
    "an unpinned link absent": check("winCodeSign-2.6.0", [...listing, { rel: "bin/helper.dll", dir: false, link: true, size: 9, crc: "00000009" }], disk),
    "a pinned link path absent for another tool": check("nsis-3.0.4.1", listing, disk),
    "a pinned path absent but listed as a regular file": check("winCodeSign-2.6.0", unlinked, disk)
  };
  const baseline = check("winCodeSign-2.6.0", listing, disk);
  const missed = Object.entries(mutations).filter(([, ok]) => ok).map(([name]) => name);
  report(
    "H3c",
    baseline && missed.length === 0 ? "PASS" : "BLOCKED",
    "Tool-cache inventory comparison negative controls",
    !baseline ? "a matching synthetic inventory was rejected; the comparison cannot be trusted" : missed.length ? `missed ${missed.length} of ${Object.keys(mutations).length} mutations (${missed.join("; ")}); the comparison cannot be trusted` : `matching inventory accepted, ${Object.keys(mutations).length} of ${Object.keys(mutations).length} mutations rejected`
  );
}
// Every file and every symbolic link or junction under the folder (readdir does not descend into links, so they are
// reported here instead of being silently skipped).
const filesUnder = (dir) =>
  fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() || d.isSymbolicLink())
    .map((d) => ({ rel: path.relative(dir, path.join(d.parentPath ?? d.path, d.name)).replace(/\\/g, "/"), link: d.isSymbolicLink() }));
for (const pin of TOOL_PINS) {
  const id = `${pin.name}-${pin.version}`;
  const installed = installedPin[pin.name];
  if (!installed || installed.version !== pin.version || installed.sha512 !== pin.sha512) {
    report("H3c", "BLOCKED", `${id} build tool`, `VERSION MISMATCH: the installed electron-builder toolchain resolves ${installed ? `${pin.name}-${installed.version}` : "an unrecognized version"}, not the pinned ${id}; this check must be reviewed against the installed toolchain before its results mean anything`);
    continue;
  }
  // Candidate archives: hashed, never trusted by name.
  let verifiedArchive = "";
  const candidates = toolArchiveDirs.flatMap((dir) => {
    try {
      return fs.readdirSync(dir, { recursive: true }).filter((entry) => path.basename(String(entry)) === `${id}.7z`).map((entry) => path.join(dir, String(entry)));
    } catch {
      return [];
    }
  });
  if (toolArchiveDirs.length > 0 && candidates.length === 0) report("H3c", "INFO", `${id}.7z archive`, `MISSING from ${toolArchiveDirs.join(", ")}`);
  for (const archive of candidates) {
    const bytes = readOr(archive, undefined, null);
    if (!bytes) {
      report("H3c", "INFO", `${id}.7z archive`, `INCONCLUSIVE: ${archive} could not be read`);
      continue;
    }
    const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    const match = sha512 === installed.sha512;
    if (match && !verifiedArchive) verifiedArchive = archive;
    report("H3c", "INFO", `${id}.7z archive`, `${match ? "PRESENT AND VERIFIED" : "CHECKSUM MISMATCH"}: ${archive}, ${bytes.length} bytes, SHA-256 ${sha256}, SHA-512 ${match ? "equals" : "differs from"} the installed toolchain's value`);
  }
  // The cache folder app-builder would reuse.
  const subDir = pin.name.includes("-") ? pin.name.slice(0, pin.name.indexOf("-")) : pin.name;
  const folder = builderCache ? path.join(builderCache, subDir, id) : "";
  const stat = folder ? fs.statSync(folder, { throwIfNoEntry: false }) : undefined;
  const foreign = builderCache && fs.existsSync(path.join(builderCache, id)) ? ` (an ${id} folder at ${path.join(builderCache, id)} uses another electron-builder's layout, which this toolchain does not read)` : "";
  if (!stat) {
    report("H3c", "INFO", `${id} in the electron-builder cache`, `${foreign ? "INVALID CACHE LAYOUT" : "MISSING"}: ${folder || "no cache folder (ELECTRON_BUILDER_CACHE and LOCALAPPDATA unset)"} is absent${foreign}; electron-builder downloads it from GitHub electron-builder-binaries and verifies the SHA-512 itself, so a networked build host is fine; an offline build host needs it provisioned from a verified archive first`);
    continue;
  }
  const onDisk = stat.isDirectory() ? filesUnder(folder) : [];
  if (onDisk.length === 0) {
    report("H3c", "BLOCKED", `${id} in the electron-builder cache`, `INVALID CACHE LAYOUT: ${folder} is ${stat.isDirectory() ? "an empty folder" : "not a folder"}, and app-builder would reuse it without checking`);
    continue;
  }
  if (!verifiedArchive) {
    report("H3c", "INFO", `${id} in the electron-builder cache`, `INCONCLUSIVE: ${folder} exists (${onDisk.length} files) but no verified ${id}.7z was supplied with --tool-archives to compare it against; app-builder reuses it without checking`);
    continue;
  }
  const listing = listArchive(verifiedArchive);
  if (!listing) {
    report("H3c", "INFO", `${id} in the electron-builder cache`, `INCONCLUSIVE: the bundled 7za could not list ${verifiedArchive}`);
    continue;
  }
  const result = compareInventory(id, listing, onDisk, (rel) => {
    const file = path.join(folder, rel);
    const present = fs.lstatSync(file, { throwIfNoEntry: false });
    return present ? { isFile: present.isFile(), link: present.isSymbolicLink(), size: present.size, crc: () => zlib.crc32(fs.readFileSync(file)).toString(16).toUpperCase().padStart(8, "0") } : null;
  });
  report(
    "H3c",
    result.ok ? "PASS" : "BLOCKED",
    `${id} in the electron-builder cache`,
    `${result.ok ? "PRESENT AND VERIFIED" : "CHECKSUM MISMATCH"}: ${folder}, ${result.files - result.linksAbsent} archive files compared by size and CRC32 against the verified ${verifiedArchive}${result.differ ? `, ${result.differ} differ or are missing` : ""}${result.extra ? `, ${result.extra} extra file(s) not in the archive` : ""}${result.linksAbsent ? `, ${result.linksAbsent} pinned macOS-only symbolic link(s) not extracted (${MACOS_ONLY_LINKS[id].join(", ")}; Windows packaging does not read them)` : ""}`
  );
}

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

// H6 Declaration-level drift guard against the packaging step's own source.
// The packaging step keeps its own definitions: verify:ai-packaged-runtime runs a byte-identical copy of
// prepare-ai-native-host.mjs alone in a scratch repository, so it cannot import a shared module. H6 therefore parses
// the step's actual declarations (comments stripped, each declaration exactly once) and compares them value by value
// with the shared module. It proves the declared values agree; it is NOT a proof of behavioral equivalence. A set of
// in-memory mutations of the step's source must each be reported as drift, so the comparison cannot pass vacuously.
const stringArray = (literal) => {
  const items = [...literal.matchAll(/"([^"\\]*)"/g)].map((m) => m[1]);
  return literal.replace(/"[^"\\]*"/g, "").replace(/[\s,[\]]/g, "") === "" ? items : null;
};
const single = (code, pattern) => {
  const all = [...code.matchAll(pattern)];
  return all.length === 1 ? all[0] : null;
};
function requirementDrift(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const runtime = single(code, /const MSVC_RUNTIME = (\[[^\]]*\]);/g);
  const floor = single(code, /const MSVC_RUNTIME_FLOOR = \[(\d+), (\d+)\];/g);
  const components = single(code, /const components = (\[[^\]]*\]);/g);
  const products = single(code, /const products = (\[[^\]]*\]);/g);
  const query = single(code, /"-version", "([^"]*)", "-products", \.\.\.products, "-requires", \.\.\.components,/g);
  const declared = {
    "MSVC_RUNTIME": runtime && stringArray(runtime[1]),
    "MSVC_RUNTIME_FLOOR": floor && [Number(floor[1]), Number(floor[2])],
    "the vswhere components": components && stringArray(components[1]),
    "the vswhere products": products && stringArray(products[1]),
    "the vswhere version range": query && query[1]
  };
  const shared = { "MSVC_RUNTIME": MSVC_RUNTIME, "MSVC_RUNTIME_FLOOR": MSVC_RUNTIME_FLOOR, "the vswhere components": VS_COMPONENTS, "the vswhere products": VS_PRODUCTS, "the vswhere version range": VS_VERSION_RANGE };
  return Object.keys(shared).filter((name) => JSON.stringify(declared[name]) !== JSON.stringify(shared[name]));
}
const prepare = fs.readFileSync(path.join(root, "scripts", "prepare-ai-native-host.mjs"), "utf8");
const mutate = (from, to) => (prepare.includes(from) ? prepare.replace(from, to) : null);
const mutations = {
  "a runtime DLL dropped": mutate('"vcruntime140.dll", "vcruntime140_1.dll"]', '"vcruntime140.dll"]'),
  "the floor lowered": mutate("const MSVC_RUNTIME_FLOOR = [14, 40];", "const MSVC_RUNTIME_FLOOR = [14, 39];"),
  "Build Tools added to the products": mutate("const products = [", 'const products = ["Microsoft.VisualStudio.Product.BuildTools", '),
  "the redist component dropped": mutate(', "Microsoft.VisualStudio.Component.VC.Redist.14.Latest"]', "]"),
  "the version range widened": mutate('"[17.0,18.0)"', '"[17.0,19.0)"'),
  "the products no longer passed to vswhere": mutate('"-products", ...products', '"-products", "*"'),
  "a second runtime declaration": `${prepare}\nconst MSVC_RUNTIME = ["msvcp140.dll"];\n`,
  "the floor left only in a comment": mutate("const MSVC_RUNTIME_FLOOR = [14, 40];", "// const MSVC_RUNTIME_FLOOR = [14, 40];\nconst MSVC_RUNTIME_FLOOR = [14, 0];")
};
const drift = requirementDrift(prepare);
const missed = Object.entries(mutations).filter(([, text]) => text === null || requirementDrift(text).length === 0).map(([name]) => name);
report(
  "H6",
  drift.length === 0 && missed.length === 0 ? "PASS" : "BLOCKED",
  "Shared requirement values equal the packaging step's declarations (declaration-level, not behavioral equivalence)",
  drift.length
    ? `drift in ${drift.join(", ")}: scripts/lib/msvc-redist-requirements.mjs no longer matches prepare-ai-native-host.mjs; reconcile them before trusting this diagnosis`
    : missed.length
      ? `the drift guard missed ${missed.length} of ${Object.keys(mutations).length} mutations (${missed.join("; ")}); it cannot be trusted`
      : `5 declarations equal, ${Object.keys(mutations).length} of ${Object.keys(mutations).length} source mutations reported as drift`
);

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
