import { resolve } from "node:path";

/**
 * True when `target` resolves to `root` itself or a path inside it.
 *
 * Used as a confinement guard for filesystem sinks that accept a caller-supplied path
 * (data-source writes, Save Session folders, `system:openPath`) so manipulated
 * workflow/profile JSON cannot read or overwrite files outside an allowed workspace.
 *
 * Comparison is separator- and case-insensitive (Windows-first), and works on the
 * resolved absolute forms so `..` traversal is normalized away before the check.
 */
export function isPathInside(root: string, target: string): boolean {
  if (!root || !target) return false;
  const norm = (p: string) => resolve(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const r = norm(root);
  const t = norm(target);
  return t === r || t.startsWith(`${r}/`);
}

/**
 * Read-confinement predicate for a JSON data-source file (audit §14). A data source may point at any
 * external user file the operator browsed to, but it must never resolve to an AWKIT-internal artifact:
 * anything inside the runtime data root (saved sessions, captured browser profiles, the durable store,
 * logs, reports) that is NOT the data-sources workspace is refused. External files and the workspace
 * are allowed. Pure so it is unit-testable without Electron; callers pass the resolved roots.
 */
export function isReadableDataSourceFile(runtimeRoot: string, dataSourcesDir: string, resolved: string): boolean {
  if (!isPathInside(runtimeRoot, resolved)) return true; // external user file — allowed
  return isPathInside(dataSourcesDir, resolved); // inside the runtime root: only the data workspace is allowed
}
