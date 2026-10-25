// Emit the package.json that makes `out/calibration-main` a launchable Electron app (Phase N, N6.6).
//
// `name` and `productName` are the real app's, so Electron resolves the SAME userData directory and with it the same
// `Local State` key that `safeStorage` uses on Windows: a master key or grant this root protects is readable by the
// dev app, and the reverse. `version` is the real app's, because grants and conditions bind the app version.
//
// Written into out/calibration-main/, which electron-builder.json excludes via `!out/calibration-main/**`.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const outDir = join(root, "out", "calibration-main");

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify(
    {
      name: pkg.name,
      productName: pkg.productName,
      version: pkg.version,
      private: true,
      type: "module",
      main: "main.js",
      _comment: "N6.6 calibration root of the non-packaged acceptance build. Excluded from packaging."
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`calibration root manifest -> ${join("out", "calibration-main", "package.json")} (version ${pkg.version})`);
