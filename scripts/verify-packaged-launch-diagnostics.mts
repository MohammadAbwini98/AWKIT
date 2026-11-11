/**
 * Packaged launch diagnostics — redaction and behaviour of the retained log lines.
 * Run with: npm run verify:packaged-launch-diagnostics
 *
 * The packaged gates (verify:ocr-packaged section B, verify:packaged-runtime part C) print the last
 * notable Chromium/app log lines when the main window never appears, and ELECTRON_ENABLE_LOGGING also
 * routes renderer console output to stderr. Those failure messages are copied into committed evidence,
 * so a retained line must never carry an absolute path (which names the Windows user), a URL, an
 * authorization header, a JWT, a key/value secret or an email address — while the diagnostic content
 * (error_code, the FATAL reason, the exit code) must survive.
 *
 * Pure: drives watchPackagedLaunch with a fake child process. No fs, browser or packaged payload.
 */
import { EventEmitter } from "node:events";
import type { ElectronApplication } from "playwright";
import { watchPackagedLaunch } from "./helpers/packaged-launch-diagnostics.mts";

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

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: string | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
}

function fakeLaunch(): { child: FakeChild; describe: () => string } {
  const child = new FakeChild();
  const app = { process: () => child } as unknown as ElectronApplication;
  const diagnostics = watchPackagedLaunch(app);
  return { child, describe: () => diagnostics.describe() };
}

// Planted values. Each must be absent from the description; none of them is a real credential.
const USER = "zq-planted-user";
const PLANTED = {
  windowsPath: `Error: cannot open C:\\Users\\${USER}\\AppData\\Local\\Temp\\awkit-profile\\runtime.sqlite`,
  uncPath: `ERROR: share \\\\Mac\\PlantedShare\\Users\\${USER}\\AWTKIT failed`,
  urlToken: "console error: fetch failed https://lab.local/api/run?token=plantedQueryToken42",
  bearer: "Error Authorization: Bearer plantedBearerValue1234567",
  jwt: "error decoding eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwbGFudGVkIn0.plantedJwtSignature",
  keyValue: 'license error: {"password": "planted two-word-secret"}',
  email: "error notifying planted.person@example.com"
};
const SECRETS = [USER, "PlantedShare", "plantedQueryToken42", "plantedBearerValue1234567", "plantedJwtSignature", "planted two-word-secret", "two-word-secret", "planted.person@example.com"];

console.log("Packaged launch diagnostics — retained log line redaction");

console.log("\nA — sensitive values never survive into the failure description");
{
  const { child, describe } = fakeLaunch();
  for (const line of Object.values(PLANTED)) child.stderr.emit("data", Buffer.from(`${line}\n`));
  const text = describe();
  for (const secret of SECRETS) check(`"${secret}" is redacted`, !text.includes(secret), text.slice(0, 400));
  check("each planted line is still represented (redacted, not dropped)", text.split(" | ").length === Object.keys(PLANTED).length, text.slice(0, 400));
}

console.log("\nB — the diagnostic content survives");
{
  const { child, describe } = fakeLaunch();
  child.stderr.emit("data", "[1:2:1111/183150.935:ERROR:child_process_launcher.cc(170)] Failed to launch process. error_code=18\n");
  child.stderr.emit("data", "[1:2:1111/183151.010:ERROR:gpu_process_host.cc(990)] GPU process launch failed: error_code=18\n");
  child.stderr.emit("data", "[1:2:1111/183152.400:FATAL:gpu_data_manager_impl_private.cc(415)] GPU process isn't usable. Goodbye.\n");
  child.stdout.emit("data", "[main] license check denied: expired\n");
  child.emit("exit", 2147483651, null);
  const text = describe();
  check("exit code reported in decimal and hex", text.includes("exited with code 2147483651 (0x80000003)"), text);
  check("error_code=18 survives", text.includes("error_code=18"), text);
  check("FATAL reason survives", text.includes("GPU process isn't usable"), text);
  check("Chromium source location survives", text.includes("child_process_launcher.cc"), text);
  check("stdout lines are retained too", text.includes("license check denied: expired"), text);
}

console.log("\nC — line handling");
{
  const { child, describe } = fakeLaunch();
  child.stderr.emit("data", "info: started\nverbose password=plantedNonNotable\n");
  check("non-notable lines are not retained", describe().endsWith("no notable log lines"), describe());
  check("process reported still running before exit", describe().startsWith("the launched process was still running"), describe());

  child.stderr.emit("data", "partial Err");
  child.stderr.emit("data", "or split across chunks\n");
  check("a line split across chunks is joined before matching", describe().includes("partial Error split across chunks"), describe());

  for (let i = 0; i < 20; i += 1) child.stderr.emit("data", `error line ${String.fromCharCode(97 + i)}\n`);
  const kept = describe().split("last notable log lines: ")[1]?.split(" | ") ?? [];
  check("only the last 12 notable lines are kept", kept.length === 12 && kept[0] === "error line i" && kept[11] === "error line t", kept.join(","));

  const long = fakeLaunch();
  long.child.stderr.emit("data", `error ${"x".repeat(600)}\n`);
  const line = long.describe().split("last notable log lines: ")[1] ?? "";
  check("each retained line is capped at 240 characters", line.length > 0 && line.length <= 240, String(line.length));

  const signalled = fakeLaunch();
  signalled.child.emit("exit", null, "SIGKILL");
  check("a signal exit is reported", signalled.describe().startsWith("the launched process exited with code none, signal SIGKILL"), signalled.describe());
}

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
