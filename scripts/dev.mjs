// Dev launcher for the Electron app.
//
// Some sandboxed/CI/agent environments export ELECTRON_RUN_AS_NODE=1 globally. That flag
// makes the Electron binary start as plain Node.js instead of as a GUI app — so
// `electron-vite dev` loads the main process under bare Node, where `require("electron")`
// returns the binary path string (no `app`/`BrowserWindow`) and an ESM main entry crashes
// in Node's ESM→CJS translator, before any app code runs. That is the "npm run dev launch
// crash" seen in headless agent environments (it is NOT a Node/Electron version mismatch).
//
// A desktop app's dev launch must never run as Node, so we always clear the flag before
// spawning electron-vite. On a normal dev machine the flag is unset, so this is a no-op.
import { spawn } from "node:child_process";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn("electron-vite", ["dev"], { stdio: "inherit", env, shell: true });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
