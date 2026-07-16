/**
 * Node module-resolution hook that redirects the bare specifier `electron` to `electron-stub.mjs`, so the
 * real `ExecutionEngine` (which transitively imports Electron-main modules) can be driven under plain
 * Node/tsx in the benchmark harness. See `electron-stub.mjs` for the rationale.
 *
 * Usage (npm scripts):
 *   node --import tsx --import ./scripts/benchmark/electron-hook.mjs <script>.mts
 *
 * `--import tsx` registers the TypeScript loader; this file registers the electron redirect. The two hooks
 * chain — this one short-circuits only `electron`; everything else falls through to tsx.
 */
import { register } from "node:module";

register("./electron-resolve.mjs", import.meta.url);
