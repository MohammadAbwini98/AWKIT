// Child-process worker for the post-abrupt-termination recovery check (plan §19.1 item 17).
// Lives in the worktree (not under %LOCALAPPDATA%) purely so normal node_modules resolution
// of "@zvec/zvec" works; the collection data it opens still lives entirely under
// %LOCALAPPDATA%\SpecterStudio\zvec-phase-0\.
import { ZVecOpen } from "@zvec/zvec";

const [, , collectionPath] = process.argv;

try {
  const c = ZVecOpen(collectionPath);
  const count = c.stats.docCount;
  c.closeSync();
  process.stdout.write(JSON.stringify({ ok: true, docCountAfterRecovery: count }));
  process.exit(0);
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
  process.exit(1);
}
