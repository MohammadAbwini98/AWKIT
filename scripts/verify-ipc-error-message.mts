/**
 * verify:ipc-error-message — IPC rejections reach the UI without Electron's transport wrapper.
 *
 * What regression makes this fail?
 *   - the `Error invoking remote method '<channel>': ` preamble stops being stripped, so a toast
 *     names an internal IPC channel again (the reported defect, awkit-x48);
 *   - the strip becomes greedy — dropping a specific error name like `TypeError:`, or matching the
 *     preamble anywhere instead of only at the start, which would mangle a domain sentence that
 *     quotes it;
 *   - an empty or non-Error rejection starts producing a blank toast;
 *   - a preload call site goes back to calling `ipcRenderer.invoke` directly, bypassing the single
 *     boundary — which is how this would silently regress for one channel at a time.
 *
 * Pure: no Electron, no browser, no IPC. The message shapes below are the literal strings Electron
 * produces, taken from the clean-machine runbook transcript that reported the defect.
 *
 * Run: npx tsx scripts/verify-ipc-error-message.mts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DEFAULT_IPC_ERROR_MESSAGE, toDisplayableIpcError, unwrapIpcErrorMessage } from "../app/main/ipcErrorMessage";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// The exact sentence from the runbook that filed awkit-x48.
const DOMAIN_MESSAGE =
  "Flow seed-fixable-operator was edited after this migration - undo would destroy those changes. " +
  "Restore manually from <path> if intended.";
const WRAPPED = `Error invoking remote method 'validation:undoMigration': Error: ${DOMAIN_MESSAGE}`;

console.log("The reported defect:");
check(
  "the undo refusal loses the remote-method wrapper",
  unwrapIpcErrorMessage(new Error(WRAPPED)) === DOMAIN_MESSAGE,
  unwrapIpcErrorMessage(new Error(WRAPPED))
);
check(
  "…and no longer names the IPC channel",
  !unwrapIpcErrorMessage(new Error(WRAPPED)).includes("validation:undoMigration")
);
check(
  "…while keeping the whole domain sentence",
  unwrapIpcErrorMessage(new Error(WRAPPED)).startsWith("Flow seed-fixable-operator") &&
    unwrapIpcErrorMessage(new Error(WRAPPED)).endsWith("if intended.")
);

console.log("\nStripping is narrow, not greedy:");
check(
  "a specific error name is PRESERVED (it signals a bug, not a refusal)",
  unwrapIpcErrorMessage(new Error("Error invoking remote method 'a:b': TypeError: x is not a function")) ===
    "TypeError: x is not a function",
  unwrapIpcErrorMessage(new Error("Error invoking remote method 'a:b': TypeError: x is not a function"))
);
check(
  "the generic `Error:` name is dropped",
  unwrapIpcErrorMessage(new Error("Error invoking remote method 'a:b': Error: plain")) === "plain"
);
check(
  "a domain sentence that QUOTES the preamble mid-message is untouched",
  unwrapIpcErrorMessage(
    new Error("Saving failed because Error invoking remote method 'x:y': Error: was logged earlier")
  ) === "Saving failed because Error invoking remote method 'x:y': Error: was logged earlier"
);
check(
  "a message with no wrapper is returned unchanged",
  unwrapIpcErrorMessage(new Error("Session expired. Sign in again.")) === "Session expired. Sign in again."
);
check(
  "nested preambles are unwrapped (a handler that invoked another channel)",
  unwrapIpcErrorMessage(
    new Error("Error invoking remote method 'a:b': Error invoking remote method 'c:d': Error: inner")
  ) === "inner"
);

console.log("\nDegenerate input never produces a blank toast:");
check("an empty message falls back", unwrapIpcErrorMessage(new Error("")) === DEFAULT_IPC_ERROR_MESSAGE);
check(
  "a wrapper with nothing after it falls back",
  unwrapIpcErrorMessage(new Error("Error invoking remote method 'a:b': ")) === DEFAULT_IPC_ERROR_MESSAGE
);
check("a non-Error rejection falls back", unwrapIpcErrorMessage({ nope: true }) === DEFAULT_IPC_ERROR_MESSAGE);
check("undefined falls back", unwrapIpcErrorMessage(undefined) === DEFAULT_IPC_ERROR_MESSAGE);
check("a string rejection is unwrapped too", unwrapIpcErrorMessage(`Error invoking remote method 'a:b': Error: s`) === "s");
check("a caller-supplied fallback is honoured", unwrapIpcErrorMessage(new Error(""), "Could not undo.") === "Could not undo.");

console.log("\ntoDisplayableIpcError keeps the original for diagnostics:");
{
  const original = new Error(WRAPPED);
  const displayable = toDisplayableIpcError(original);
  check("it is an Error", displayable instanceof Error);
  check("its message is the cleaned one", displayable.message === DOMAIN_MESSAGE);
  check(
    "the original — including the channel — survives as `cause`",
    (displayable as Error & { cause?: unknown }).cause === original &&
      String((original as Error).message).includes("validation:undoMigration")
  );
}

console.log("\nThe boundary is single — no call site may bypass it:");
{
  const preload = readFileSync(resolve(ROOT, "app/main/preload.ts"), "utf8");
  check("the source guard actually read preload", preload.includes("contextBridge") && preload.length > 5000);
  const direct = preload.split("ipcRenderer.invoke(").length - 1;
  // Exactly one: the wrapper's own call. Cardinality, not `=== 0`, so the guard also notices the
  // wrapper being deleted.
  check("exactly one direct ipcRenderer.invoke call remains (the wrapper)", direct === 1, `found ${direct}`);
  const wrapped = preload.split(/[^.\w]invoke\(/).length - 1;
  check("the wrapper is used by the whole API surface", wrapped > 150, `${wrapped} wrapped call sites`);
  check("the wrapper routes rejections through the unwrapper", /catch[\s\S]{0,120}toDisplayableIpcError/.test(preload));
  check(
    "event subscriptions still use ipcRenderer directly (not rewritten by mistake)",
    preload.includes("ipcRenderer.on(") && preload.includes("ipcRenderer.removeListener(")
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
