/**
 * Build config for the N6.6 visual-assertion calibration root ONLY (Phase N, awkit-vra.15.6; VA-16).
 *
 * A separate config with a separate output directory, like `electron.vite.test-roots.config.ts`: adding the entry to
 * `electron.vite.config.ts` would emit it into `out/main/`, which `electron-builder.json` ships, so the grant issuer
 * would land inside the packaged application. It goes to `out/calibration-main/` instead, which that config excludes
 * explicitly (`verify:visual-calibration` pins both).
 *
 * Run: `npm run build:calibration` (the benchmark runs it first).
 */
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/calibration-main",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "app/main/calibration/visualCalibrationRoot.ts")
        },
        output: {
          inlineDynamicImports: true,
          entryFileNames: "main.js"
        }
      }
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "app/main"),
        "@src": resolve(__dirname, "src")
      }
    }
  }
});
