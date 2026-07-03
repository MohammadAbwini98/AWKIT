import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    // Externalize node_modules dependencies (notably playwright and its
    // transitive deps like chromium-bidi) so they are loaded from node_modules
    // at runtime instead of being bundled into the main chunk. Bundling breaks
    // Playwright's own external requires with ERR_MODULE_NOT_FOUND.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "app/main/main.ts")
        }
      }
    },
    resolve: {
      alias: {
        "@main": resolve(__dirname, "app/main"),
        "@src": resolve(__dirname, "src")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, "app/main/preload.ts")
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, "app/renderer"),
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          renderer: resolve(__dirname, "app/renderer/index.html")
        }
      }
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "app/renderer"),
        "@src": resolve(__dirname, "src")
      }
    }
  }
});
