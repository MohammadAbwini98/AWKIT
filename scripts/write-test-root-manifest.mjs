// Emit the package.json that makes `out/test-main` a launchable Electron app directory
// (bd awkit-8ri). Electron resolves an app's entry point from the `main` field of the package.json
// in the directory it is handed, so the built test composition root needs one of its own.
//
// `"type": "module"` mirrors the repo's own package.json so the emitted ESM bundle loads the same
// way the production main bundle does.
//
// This file is written into out/test-main/, which electron-builder.json excludes via
// `!out/test-main/**` — it never reaches a packaged application.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "out", "test-main");

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify(
    {
      name: "specterstudio-test-composition-root",
      productName: "SpecterStudio",
      version: "0.0.0-test",
      private: true,
      type: "module",
      main: "main.js",
      _comment:
        "TEST ONLY. Boots the real app with an injected secret-storage capability. Excluded from packaging."
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`test composition root manifest → ${join("out", "test-main", "package.json")}`);
