/**
 * L10.0 DOM-intelligence gate consistency (awkit-djnl.18).
 *
 * Run with: npm run verify:dom-intelligence-gate
 *
 * Offline: no Python, no browser. Proves the committed L10.0 evidence cannot drift from its inputs:
 *   - the frozen fixtures still render to the page hashes the benchmark recorded;
 *   - the committed tally and BOTH gate decisions re-derive from the committed per-case data through
 *     the pre-registered rule in scripts/dom-intelligence/gate.mts;
 *   - the measured venv was exactly the parser-only closure (no fetcher, browser or AI package) and
 *     no forbidden Scrapling module was ever loaded;
 *   - the evidence report and DECISIONS.md state the same decisions as the data.
 * Regenerate the data with npm run benchmark:dom-intelligence (needs the dev venv).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DOM_CASES, NORMALIZATION_PAGE, fixtureSetHash, sha256 } from "./dom-intelligence/fixtures.mts";
import { decideLocatorGate, decideNormalizationGate, tallyLocator, type CaseResult, type NormalizationMethod } from "./dom-intelligence/gate.mts";

const RESULTS = resolve("docs/plans/ai-upgrade-v5/evidence/L10.0-dom-intelligence-results.json");
const REPORT = resolve("docs/plans/ai-upgrade-v5/evidence/L10.0-dom-intelligence-gate-2026-09-30.md");
const DECISIONS = resolve("docs/ai/DECISIONS.md");

/** Scrapling 0.4.15's base requires_dist and nothing else — stated here independently of the setup script. */
const PARSER_ONLY = ["cssselect", "lxml", "orjson", "scrapling", "tld", "typing_extensions", "w3lib"];
const FORBIDDEN_PACKAGES = ["playwright", "patchright", "curl_cffi", "curl-cffi", "browserforge", "apify-fingerprint-datapoints", "mcp", "markdownify", "ipython", "msgspec", "anyio", "protego", "click"];
const ENGINE_STATUSES = new Set(["resolved", "unresolved", "ambiguous", "error"]);

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

const results = JSON.parse(readFileSync(RESULTS, "utf8"));
const report = readFileSync(REPORT, "utf8");
const decisions = readFileSync(DECISIONS, "utf8");
const cases = results.cases as CaseResult[];

console.log("Frozen fixtures:");
check("results schema is version 1", results.schemaVersion === 1);
check("the fixture set has cases to check", DOM_CASES.length === 16, String(DOM_CASES.length));
check("fixture set hash matches a fresh render", results.fixtureSetHash === fixtureSetHash(), `${results.fixtureSetHash} vs ${fixtureSetHash()}`);
const hashes = new Map((results.casePageHashes as Array<{ id: string; baseline: string; mutated: string }>).map((h) => [h.id, h]));
check(
  "every case page re-renders to its recorded hash",
  DOM_CASES.every((c) => hashes.get(c.id)?.baseline === sha256(c.baseline) && hashes.get(c.id)?.mutated === sha256(c.mutated)),
  DOM_CASES.filter((c) => hashes.get(c.id)?.mutated !== sha256(c.mutated)).map((c) => c.id).join(", ")
);
check("the normalization page re-renders to its recorded hash", results.normalizationPageHash === sha256(NORMALIZATION_PAGE));

console.log("Coverage:");
check("results cover exactly the fixture cases", cases.length === DOM_CASES.length && DOM_CASES.every((c, i) => cases[i]?.id === c.id), cases.map((c) => c.id).join(","));
check("every expectation matches its fixture", DOM_CASES.every((c, i) => cases[i]?.expectation === c.expectation));
check("both expectations are exercised", cases.some((c) => c.expectation === "recoverable") && cases.some((c) => c.expectation === "no-match"));
check(
  "every AWKIT engine outcome has a known status",
  cases.every((c) => [c.production, c.localOnly, c.localAndBlueprint].every((o) => ENGINE_STATUSES.has(o.status)))
);
check("every Scrapling outcome has a candidate count", cases.every((c) => Number.isInteger(c.scrapling.candidateCount) && c.scrapling.candidateCount >= 0));
check(
  "every browser path mapping agreed with the host's verdict",
  (results.pathMappingAgreesWithBrowser as Array<{ agrees: boolean | null }>).every((row) => row.agrees !== false)
);

console.log("Gate re-derivation (pre-registered rule):");
const tally = tallyLocator(cases);
check("the committed tally re-derives from the per-case data", JSON.stringify(tally) === JSON.stringify(results.tally), JSON.stringify(tally));
const locatorGate = decideLocatorGate(tally, results.warmRelocateMs.all.p95);
check("the locator gate re-derives", JSON.stringify(locatorGate) === JSON.stringify(results.gates.locator), JSON.stringify(locatorGate));
const methods = results.normalization.methods as NormalizationMethod[];
check("three normalization methods were measured", methods.length === 3 && methods.some((m) => m.method === "scrapling-static-text"));
const normalizationGate = decideNormalizationGate(methods);
check("the normalization gate re-derives", JSON.stringify(normalizationGate) === JSON.stringify(results.gates.normalization), JSON.stringify(normalizationGate));

console.log("Parser-only runtime:");
const frozen = ((results.install?.pipFreeze ?? []) as string[]).map((line) => line.split("==")[0].toLowerCase().replace(/-/g, "_"));
check("the measured venv held exactly the parser-only closure", JSON.stringify([...frozen].sort()) === JSON.stringify(PARSER_ONLY), frozen.join(","));
const installed = (results.inventory?.distributions ?? []) as Array<{ name: string }>;
const installedNames = installed.map((d) => d.name.toLowerCase().replace(/-/g, "_"));
check("no fetcher, browser or AI package was installed", installedNames.length > 0 && !installedNames.some((n) => FORBIDDEN_PACKAGES.some((f) => f.replace(/-/g, "_") === n)), installedNames.join(","));
check("pip check reported no broken requirement", results.install?.pipCheck?.status === 0);
check(
  "every wheel has a recorded SHA-256 and size",
  Array.isArray(results.install?.wheels) && results.install.wheels.length === PARSER_ONLY.length && results.install.wheels.every((w: { sha256: string; bytes: number }) => /^[0-9a-f]{64}$/.test(w.sha256) && w.bytes > 0)
);
check("no forbidden Scrapling or browser module was loaded at start", Array.isArray(results.forbiddenModulesLoadedAtReady) && results.forbiddenModulesLoadedAtReady.length === 0);
check("no forbidden module was loaded by the end of the run", Array.isArray(results.inventory?.forbiddenModulesLoaded) && results.inventory.forbiddenModulesLoaded.length === 0);
check("Scrapling's default adaptive database was never created", results.inventory?.defaultAdaptiveDbExists === false);

console.log("Evidence consistency:");
for (const [label, decision] of [["Locator integration gate", results.gates.locator.decision], ["DOM normalization gate", results.gates.normalization.decision]] as const) {
  check(`the evidence report states "${label}: ${decision}"`, report.includes(`${label}: ${decision}`));
  check(`DECISIONS.md states "${label}: ${decision}"`, decisions.includes(`${label}: ${decision}`));
}
check("the committed data carries no absolute local path", !/[A-Za-z]:\\\\Users\\\\|\/Users\//.test(readFileSync(RESULTS, "utf8")));

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
