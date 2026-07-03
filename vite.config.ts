import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "app/renderer",
  plugins: [react()],
  resolve: {
    alias: {
      "@renderer": resolve(__dirname, "app/renderer"),
      "@src": resolve(__dirname, "src")
    }
  }
});
