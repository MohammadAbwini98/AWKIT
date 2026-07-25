// Child-process worker for the restart-persistence check (plan §19.1 item 15 / §19.3).
// Reopens an existing collection in a brand-new process and reports whether the data
// inserted by the parent process is still present, proving persistence survives a real
// OS process boundary (not just an in-memory handle).
import { runOpsHarness } from "./zvecOpsHarness.mjs";

const [, , collectionPath] = process.argv;

try {
  const before = (await import("@zvec/zvec")).ZVecOpen(collectionPath);
  const docCountBeforeReopen = before.stats.docCount;
  before.closeSync();

  const result = await runOpsHarness(collectionPath, { reopenOnly: true, runTag: "restart" });
  process.stdout.write(JSON.stringify({ ok: result.ok, docCountBeforeReopen, steps: result.steps }));
  process.exit(result.ok ? 0 : 1);
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
}
