/**
 * Parse scripts/lib/verifier-classification.ts against package.json.
 *
 * The registry declares what each verifier ACTUALLY exercises, over a fixed seven-value taxonomy,
 * so that a structural check is never counted as runtime validation. Reading it lets the dashboard
 * report per-class verifier counts without running anything.
 *
 * This also mirrors, read-only, the reconciliation that scripts/verify-verifier-classification.mts
 * enforces: every verify:* / validate:* script must be classified, and every classified entry must
 * still exist. Surfacing both directions here means the dashboard shows the drift before the gate
 * fails in CI.
 *
 * Regex rather than import, for the same reason as the phases parser: this is a .ts file under
 * scripts/, and the dashboard runs on bare node with no tsx.
 */

import { readSource } from "./read-cache.mjs";

/** `"verify:runner": { class: "real-browser", why: "..." },` */
const ENTRY = /^\s*"([^"]+)":\s*\{\s*class:\s*"([^"]+)"/gm;
const CLASS_LIST = /export const VERIFIER_CLASSES = \[([\s\S]*?)\] as const;/;
const VERIFIER_SCRIPT = /^(verify|validate):/;

/**
 * @returns {{
 *   ok: boolean,
 *   classes: string[],
 *   byClass: {name: string, count: number}[],
 *   entries: {script: string, class: string, present: boolean}[],
 *   unclassified: string[],
 *   stale: string[],
 *   warnings: string[],
 *   stats: Record<string, number>,
 *   mtimeMs: number
 * }}
 */
export function parseVerifiers() {
  const registry = readSource("verifierClassification");
  const pkg = readSource("packageJson");
  /** @type {string[]} */
  const warnings = [];

  const empty = {
    ok: false,
    classes: [],
    byClass: [],
    entries: [],
    unclassified: [],
    stale: [],
    warnings,
    stats: {},
    mtimeMs: Math.max(registry.mtimeMs, pkg.mtimeMs)
  };

  if (!registry.ok) {
    warnings.push(`verifierClassification: ${registry.error}`);
    return empty;
  }
  if (!pkg.ok) {
    warnings.push(`packageJson: ${pkg.error}`);
    return empty;
  }

  /** @type {string[]} */
  let scripts = [];
  try {
    const parsed = JSON.parse(pkg.text);
    scripts = Object.keys(parsed.scripts ?? {});
  } catch (err) {
    warnings.push(
      `packageJson: unparseable (${err instanceof Error ? err.message : String(err)})`
    );
    return empty;
  }

  const classes = (CLASS_LIST.exec(registry.text)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  if (classes.length === 0) warnings.push("verifierClassification: could not read VERIFIER_CLASSES");

  /** @type {Map<string, string>} */
  const classified = new Map();
  for (const m of registry.text.matchAll(ENTRY)) classified.set(m[1], m[2]);

  if (classified.size === 0) {
    warnings.push("verifierClassification: no entries matched — the registry format may have changed");
    return empty;
  }

  const verifierScripts = scripts.filter((s) => VERIFIER_SCRIPT.test(s));
  const scriptSet = new Set(verifierScripts);

  // Both directions of the drift that verify:verifier-classification enforces.
  const unclassified = verifierScripts.filter((s) => !classified.has(s)).sort();
  const stale = [...classified.keys()].filter((s) => !scriptSet.has(s)).sort();

  for (const s of unclassified) {
    warnings.push(`verifiers: npm script "${s}" is not in the classification registry`);
  }
  for (const s of stale) {
    warnings.push(`verifiers: registry entry "${s}" has no matching npm script`);
  }

  /** @type {Map<string, number>} */
  const counts = new Map(classes.map((c) => [c, 0]));
  for (const [script, cls] of classified) {
    if (!scriptSet.has(script)) continue; // count only what can actually be run
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
    if (classes.length > 0 && !classes.includes(cls)) {
      warnings.push(`verifiers: "${script}" declares unknown class "${cls}"`);
    }
  }

  const byClass = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const entries = [...classified.entries()]
    .map(([script, cls]) => ({ script, class: cls, present: scriptSet.has(script) }))
    .sort((a, b) => a.script.localeCompare(b.script));

  return {
    ok: true,
    classes,
    byClass,
    entries,
    unclassified,
    stale,
    warnings,
    stats: {
      npmScripts: scripts.length,
      verifierScripts: verifierScripts.length,
      classified: classified.size,
      runnableClassified: entries.filter((e) => e.present).length,
      unclassified: unclassified.length,
      stale: stale.length,
      classes: classes.length
    },
    mtimeMs: Math.max(registry.mtimeMs, pkg.mtimeMs)
  };
}
