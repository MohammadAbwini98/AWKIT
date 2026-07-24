import { resolve } from "node:path";

/** Windows device names that are illegal as a bare file/dir name (case-insensitive, any extension). */
const WINDOWS_RESERVED_NAMES = new Set<string>([
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`)
]);

/** Short, stable, filesystem-safe hash used only to disambiguate truncated components (FNV-1a → base36). */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Reduce an arbitrary identifier (executionId, flowId, step id, page alias, …) to a single SAFE path
 * component — never a path, never a traversal, never a Windows-reserved or empty name.
 *
 * Guarantees: no `/` or `\`; `..` runs neutralized; Windows-invalid + control chars replaced; leading/
 * trailing dots and spaces stripped; reserved device names prefixed; bounded length (with a short hash
 * appended on truncation so distinct long inputs don't collide); never empty (falls back to
 * `fallback`); readable content preserved where possible. Pure and unit-testable.
 */
export function safePathComponent(raw: string | null | undefined, fallback: string): string {
  const fb = fallback && fallback.length > 0 ? fallback : "x";
  let s = typeof raw === "string" ? raw : "";
  s = s.replace(/[\\/]+/g, "_"); // strip both separators
  s = s.replace(/\.{2,}/g, "_"); // neutralize `..` (and longer dot runs) so no traversal survives
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[<>:"|?*\x00-\x1f]+/g, "_"); // Windows-invalid + control characters
  s = s.replace(/\s+/g, "_"); // collapse whitespace
  s = s.replace(/^[.\s_]+/, "").replace(/[.\s_]+$/, ""); // trim leading/trailing dots/spaces/underscores
  const bare = (s.split(".")[0] ?? "").toLowerCase();
  if (WINDOWS_RESERVED_NAMES.has(bare)) s = `_${s}`;
  const MAX = 80;
  if (s.length > MAX) s = `${s.slice(0, MAX - 9)}_${shortHash(s)}`;
  return s.length > 0 ? s : fb;
}

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
