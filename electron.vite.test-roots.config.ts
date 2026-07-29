/**
 * Build config for TEST composition roots only (bd `awkit-8ri`).
 *
 * Deliberately a separate config with a separate output directory. Adding these entries to
 * `electron.vite.config.ts` would emit them into `out/main/`, which `electron-builder.json` ships
 * wholesale via `out/**` — so the test roots would land inside the packaged application. They go to
 * `out/test-main/` instead, which that config excludes explicitly.
 *
 * `out/test-main` is a sibling of `out/preload` and `out/renderer`, so the real window manager's
 * `join(__dirname, "../preload/preload.mjs")` and `"../renderer/index.html"` resolve unchanged.
 *
 * Run: `npm run build:test-roots` (requires `npm run build` first for preload + renderer).
 */
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/test-main",
      rollupOptions: {
        input: {
          main: resolve(__dirname, "app/main/testing/unavailableSecretStorageRoot.ts")
        },
        output: {
          // MUST stay a single file. The root's `await import("../main")` otherwise creates a chunk
          // boundary and the app code lands in `out/test-main/chunks/`, where `__dirname` is one
          // level deeper — so `join(__dirname, "../preload/preload.mjs")` resolves to
          // `out/test-main/preload/…` and the window opens with no preload bridge. Inlining keeps the
          // dynamic import's ORDERING (the capability is still installed before the app evaluates)
          // while emitting one file whose __dirname is a sibling of out/preload and out/renderer.
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
