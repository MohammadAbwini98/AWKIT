/**
 * verify:roadmap-dashboard — static source validation for tools/roadmap.
 *
 * What regression makes this fail?
 *   - a document this dashboard reads is renamed, moved, or restructured (a heading level changes,
 *     a CSV column is added, the roadmap array literal is reformatted);
 *   - the ledger tally in CURRENT_STATE.md or HANDOFF.md drifts from the case file itself;
 *   - the ordering algorithm stops producing a gapless deterministic rank, or marks an item ready
 *     while it still has an open blocker;
 *   - a provenance guarantee is broken — a derived agent attribution acquires the authority of a
 *     declared one;
 *   - a global.css class the dashboard borrows is renamed, so the page would silently lose styling;
 *   - a CDN or remote URL is introduced into the page, breaking the offline rule.
 *
 * Deliberately .mjs: tsconfig.scripts.json covers .mts only and verify-source-hygiene globs
 * .ts/.mts/.tsx, so this file stays outside both — matching the existing node scripts/verify-*.mjs
 * entries. It never launches a browser or the Electron app, which is why it is classified
 * static-source-validation rather than real-browser.
 */

import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readAssignments } from "../tools/roadmap/lib/agents.mjs";
import { buildSnapshot } from "../tools/roadmap/lib/model.mjs";
import { deriveAreaWeighted, normalizeBeadStatus, normalizePhases } from "../tools/roadmap/lib/normalize.mjs";
import { computeOrder } from "../tools/roadmap/lib/order.mjs";
import { KNOWN_EDGE_TYPES, KNOWN_STATUSES, parseBeads } from "../tools/roadmap/lib/parse-beads.mjs";
import { LEDGER_STATUSES, parseLedger } from "../tools/roadmap/lib/parse-ledger.mjs";
import { parseNarrative } from "../tools/roadmap/lib/parse-narrative.mjs";
import { EXPECTED_PHASE_IDS, extractPhases } from "../tools/roadmap/lib/parse-roadmap-phases.mjs";
import { TRACE_STATUSES, parseTraceability } from "../tools/roadmap/lib/parse-traceability.mjs";
import { readSource } from "../tools/roadmap/lib/read-cache.mjs";
import { REPO_ROOT, ROADMAP_ROOT, SOURCES, sourcePath } from "../tools/roadmap/lib/sources.mjs";
import { readApiPayload, ROADMAP_SERVER_RESTART_MESSAGE } from "../tools/roadmap/public/dom.js";

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  OK ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

function hasPortableCommitHeadroomGuard(source) {
  const inputPreflightStep = source.indexOf('Write-Step "Validating offline packaging inputs"');
  const earlyPreflight = source.indexOf("Assert-PackagingCommitHeadroom", inputPreflightStep);
  const buildStep = source.indexOf('Write-Step "Building the application bundle"', inputPreflightStep);
  const packagingStep = source.indexOf('Write-Step "Packaging the portable EXE"');
  const preflight = source.indexOf("Assert-PackagingCommitHeadroom", packagingStep);
  const builder = source.indexOf("npx electron-builder --win portable", packagingStep);
  return (
    inputPreflightStep >= 0 &&
    earlyPreflight > inputPreflightStep &&
    buildStep > earlyPreflight &&
    packagingStep >= 0 &&
    preflight > packagingStep &&
    builder > preflight &&
    source.includes("Win32_OperatingSystem") &&
    source.includes("FreeVirtualMemory") &&
    source.includes("MinimumPackagingCommitHeadroomMiB") &&
    source.includes("free Windows commit") &&
    source.includes("increase the Windows pagefile") &&
    source.includes('Write-Host "[FAIL]  $message"')
  );
}

function probePortableCommitHeadroomSuccess(source) {
  const functionStart = source.indexOf("function Assert-PackagingCommitHeadroom");
  const firstPipelineStep = source.indexOf('Write-Step "Validating offline packaging inputs"', functionStart);
  if (functionStart < 0 || firstPipelineStep < 0) {
    return { ok: false, detail: "headroom function or pipeline marker is missing" };
  }

  const functionSource = source.slice(functionStart, firstPipelineStep);
  const harness = `${functionSource}
function Get-CimInstance {
  [pscustomobject]@{ FreeVirtualMemory = 2105344; TotalVirtualMemorySize = 33337344 }
}
$MinimumPackagingCommitHeadroomMiB = 1536
Assert-PackagingCommitHeadroom
`;
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", harness],
    { cwd: REPO_ROOT, encoding: "utf8", windowsHide: true }
  );
  const expected = "Packaging memory preflight: 2056 MiB free Windows commit of 32556 MiB (1536 MiB minimum).";
  return {
    ok: result.status === 0 && result.stdout.includes(expected) && result.stderr.trim() === "",
    detail: `exit=${result.status}; stdout=${JSON.stringify(result.stdout.trim())}; stderr=${JSON.stringify(result.stderr.trim())}`
  };
}

function preservesPortableChildExitCode(source) {
  const child = source.indexOf('& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "package-portable.ps1")');
  const capture = source.indexOf("$packageExitCode = $LASTEXITCODE", child);
  const branch = source.indexOf("if ($packageExitCode -ne 0)", capture);
  const cleanup = source.indexOf("Restore-GeneratedReleaseFiles", branch);
  const report = source.indexOf("exit $packageExitCode", cleanup);
  return child >= 0 && capture > child && branch > capture && cleanup > branch && report > cleanup;
}

/** A frozen clock, so the snapshot is a pure function of the files on disk. */
const NOW = Date.parse("2026-07-27T12:00:00Z");

try {
  /* ======================================================================
     1. Sources
     ====================================================================== */
  console.log("Sources:");
  check("14 sources are registered", SOURCES.length === 14, `got ${SOURCES.length}`);
  for (const source of SOURCES) {
    const read = readSource(source.id);
    check(`${source.rel} is readable`, read.ok, read.error ?? "");
  }
  check(
    "every unparsed source states why",
    SOURCES.filter((s) => !s.parsed).every((s) => typeof s.skipReason === "string" && s.skipReason.length > 0)
  );

  /* ======================================================================
     2. Beads
     ====================================================================== */
  console.log("Beads issue tracker:");
  const beads = parseBeads();
  check("268 issues parse", beads.stats.total === 268, `got ${beads.stats.total}`);
  // Moved 22/96 → 21/97 (`awkit-0jp`) → 20/98 (`awkit-thg`) → 19/99 (`awkit-epz`) →
  // 18/100 (`awkit-y24`) → 17/101 (`awkit-4km`) on 2026-07-28 → 6/113, then 5/114, then 6/114 on 2026-07-29 when Codex filed awkit-f3l (owner decisions
  // closed `awkit-wza.8`, `awkit-wza` and `awkit-8ri`; SET-015 carved out as `awkit-hlp`, so the
  // total also moved 118 → 119). Then 8/114 on 2026-07-29 when the clean-machine run-based checks
  // filed `awkit-vbj` (run reports omit Legacy Compatibility attribution) and `awkit-5ci`
  // (runbook 8.7-8.11), moving the total 120 → 122. Move this pin deliberately when a bead closes —
  // never relax it to a range, or it stops noticing that the export was not refreshed
  // (`bd close` does not rewrite `.beads/issues.jsonl`; `bd export -o .beads/issues.jsonl` does —
  // plain `bd export` writes to STDOUT and leaves the file untouched).
  // Then 8/115 of 123 on 2026-07-30: the clean-machine migration ceremony closed `awkit-5ci` and
  // filed `awkit-x48` (undo-refusal toast leaks the IPC channel name).
  // Then 10/115 of 125 on 2026-07-30, from the full single-artifact gate run: `awkit-3zr` (the run
  // itself, in progress), `awkit-k2s` (Flow Library re-scan action absent in the installed app).
  // Then 10/116 of 126 when the full single-artifact gate run finished: `awkit-3zr` closed,
  // `awkit-o7r` filed (undo offered for records that cannot be undone) — then 9/117 when that fix
  // landed and `awkit-o7r` closed.
  // Then 9/118 of 127 on 2026-07-30: `awkit-843` (Graphify code knowledge graph integration) filed
  // and closed in the same session, so the total moved 126 → 127 and closed 117 → 118 while
  // outstanding stayed put. This pin caught its own documented trap that session: `bd close`
  // followed by a plain `bd export` left the export showing `awkit-843` still open.
  // Then 17/118 of 135 on 2026-07-31: epic `awkit-aui` (Recorder ambiguity-resolution &
  // recorded-flow replayability, AWKIT-REC-030) filed with 7 dependency-ordered children
  // (`awkit-aui.1`…`.6`, `.8`), adding 8 outstanding (total 127 → 135) and 7 edges (76 → 83).
  // Then 18/121 of 139 on 2026-08-01: `awkit-aui.5` (Inc5 hover-replay repair, AWKIT-REC-031) and
  // `awkit-aui.8` (Inc7 nine-point ambiguity gate) closed; four follow-ups filed OPEN — `awkit-bw9`
  // (table-row container-name replay gap), `awkit-vot` + `awkit-0vm` (Inc5 hover residuals), and
  // `awkit-hj8` (dependency-manifest audit). Net: total 135 → 139, closed 120 → 121, outstanding 15 → 18.
  // Then 16/123 of 139 on 2026-08-01: `awkit-aui.2` (Inc2 reconciled complete) and `awkit-bw9` (table-row
  // container-name replay fix, AWKIT-REC-032) closed; no new issues. Increment 6 (`awkit-aui.6`)
  // then closed: 16 → 15 outstanding, total unchanged at 139.
  // Reconciliation filed two defect children (`awkit-aui.3.1` / `.4.1`), raising total/edges to
  // 141/91, then closed both children, Increments 3/4, and parent epic: 12 outstanding / 129 closed.
  // The licensing/manifest closure filed key-custody follow-up `awkit-2l1` (one issue and one edge),
  // then closed `awkit-f3l` and `awkit-hj8`: 142/92, 11 outstanding / 131 closed.
  // Recorder hover review filed `awkit-3vh` and the separate catalog defect `awkit-8lz`, then closed
  // `awkit-3vh`: total 144, edges unchanged at 92, 12 outstanding / 132 closed.
  // Then 11/133 of 144 on 2026-08-02: `awkit-8lz` closed (hover catalog entry + explicit Unknown-step
  // rendering + `verify:flow-node-catalog-parity`); no new issues or edges filed.
  // Then 11/134 of 145 on 2026-08-02: `awkit-vot` closed (adjacent-sibling hover attribution) and
  // `awkit-hmt` filed for the remote non-adjacent boundary it deliberately leaves open — one issue in,
  // one out, so outstanding held while total and closed each rose by one. Edges unchanged at 92.
  // Then 10/135 of 145 on 2026-08-02: `awkit-0vm` closed (hover-inserted control attribution); no new
  // issues or edges filed — the remote-trigger boundary stays on `awkit-hmt`.
  // Then 10/136 of 146 on 2026-08-02: `awkit-hmt` closed (remote hover attribution) and `awkit-a7k`
  // filed (the verifier harness installs the init script after load, not at document start) — one in,
  // one out, so outstanding held while total and closed each rose by one. Edges unchanged at 92.
  // Then 9/137 of 146 on 2026-08-02: `awkit-a7k` closed (recorder baselines the loaded page; the
  // verifiers now install at document start like production). No new issues or edges.
  // Then 9/138 of 147 on 2026-08-02: `awkit-0tn` was filed and closed (singleton Issuer role and
  // in-app offline license issuance). No new edges.
  // Then 10/139 of 149 on 2026-08-02: `awkit-x48` closed (IPC toast no longer leaks the channel
  // name), and two filed during the same session - `awkit-5ea` (issuer key has no synced-folder
  // custody check, found reviewing the issuer console) and `awkit-73s` (an intermittent geometry
  // check in the Flow Designer GUI gate). Net: total +2, closed +1, outstanding 9 -> 10.
  // Then 9/140 of 149 on 2026-08-02: `awkit-5ea` closed (issuer key custody). No new issues.
  // Then 9/141 of 150 on 2026-08-03: `awkit-vbj` closed (Legacy Compatibility attribution in the
  // execution report) and `awkit-5dn` filed for the run-detail drawer, which needs a durable-store
  // migration — one in, one out, so outstanding held while total and closed each rose by one.
  // Then 10/141 of 151 on 2026-08-03: `awkit-iu7` filed for three runnable verifier files that are
  // absent from package.json and therefore invisible to the classified project gates.
  // Then 9/142 of 151 on 2026-08-03: `awkit-iu7` closed — the three verifiers registered + classified
  // + documented, and a filesystem→package.json reconciliation direction added. No new issues.
  // Then 8/143 of 151 on 2026-08-03: `awkit-73s` closed — corrected the Flow Designer geometry
  // assertions to the settled inset design and replaced the fixed-delay wait with
  // Animation.finished + geometry-stability polling. No new issues.
  // Then 9/143 of 152 on 2026-08-03: `awkit-k2s` defensive hardening filed `awkit-a6a` (release-
  // custody incident: signing key absent from both approved locations, P1, OPEN, deliberately not
  // fixed as part of this bead). `awkit-k2s` itself stays open/in-progress — hardening implemented,
  // installed-artifact acceptance still pending a signed NSIS artifact. Total/outstanding +1, closed
  // unchanged.
  // Then 8/144 of 152 on 2026-08-03: `awkit-5dn` closed (Run Detail drawer now shows Legacy
  // Compatibility attribution via a durable-store v5 migration). No new issues.
  // Then 6/146 of 152 on 2026-08-03: `awkit-a6a` and `awkit-2l1` both closed — the owner generated a
  // fresh Ed25519 offline-manifest signing key directly at the approved LOCALAPPDATA custody path
  // (never touching the OneDrive-synced tree), rotated the public key, and re-signed the manifest.
  // Then `awkit-k2s` closed and `awkit-9yc` was filed: 6/147 of 153. `awkit-9yc` then closed after
  // explicit `/currentuser /S` passed the clean-VM A/B install control: 5/148 of 153. Then
  // `awkit-hlp` closed after the owner-approved SET-015 exact-path Explorer check passed:
  // 4/149 of 153, edges 93.
  // Then 2026-08-04: `awkit-wmq` filed AND closed (Recorder nested container chains + causal popup
  // URL/context capture), and `awkit-f2q` filed for the outstanding mock-site popup fixtures:
  // 5/150 of 155, edges 93. `awkit-f2q` then closed once Scenario J landed as real Feature Test Lab
  // pages: 4/151 of 155, edges 93. Then the awkit-wmq review residuals were filed and closed the
  // same day — `awkit-45d` (popup identity locked to a client-side redirect hop, which also
  // uncovered opener-attribution theft and action reordering), `awkit-tir` (setTimeout(0) yield +
  // chain-cap source guard) and `awkit-y53` (frame/shadow/reorder chain coverage): 4/154 of 158,
  // edges 93. Then `awkit-871` was filed (Flow Designer cannot resolve a non-positional
  // needs-review locator): 5/154 of 159, edges 93. It is the only OPEN item — the other four
  // remain `blocked` on the owner.
  // Then 2026-08-04: epic `awkit-65g` (Recorder always emits an automatically-resolvable locator) filed
  // with two remaining-phase children `awkit-y1p` (C1 cross-origin frame-chain) and `awkit-3zf` (C2
  // instrumented closed-shadow), all OPEN: 8/154 of 162, edges 93 (epic↔task edges not added — a task
  // cannot block an epic). Phases 0/A/B of the epic landed as code (main @ ecb72d2) and are recorded in
  // TASK_LOG, not as separate beads.
  // Then `awkit-y1p` (C1) closed once the cross-origin frame-chain resolver landed (main @ 8fc9d32,
  // verify:frame-chain 25/0): 7/155 of 162, edges 93. `awkit-3zf` (C2) remains OPEN.
  // Then the epic completed: `awkit-3zf` (C2 instrumented closed-shadow, verify:closed-shadow 23/0),
  // `awkit-871` (superseded — no non-positional needs-review reaches the designer) and the parent epic
  // `awkit-65g` all closed: 4/158 of 162, edges 93. The 4 outstanding are the owner-gated items
  // (`awkit-cey`/`awkit-7bu`/`awkit-az7`/`awkit-cm8`).
  // Then 2026-08-05: the Locator Blueprint recovery review filed four OPEN follow-ups — `awkit-qpv`
  // (second-layer ordering + neighborhood scan), `awkit-utj` (sensitive-action refusal), `awkit-3ut`
  // (frame page-key + variant gate) and `awkit-c2z` (real-browser verifier) — with two `blocks` edges
  // (qpv→c2z, 3ut→c2z): 8/158 of 166, edges 93 → 95.
  // Then 2026-08-06: Recorder competitive deep-testing filed `awkit-fbq` (contenteditable typed text
  // not captured), OPEN, no new edges: 9/158 of 167, edges 95.
  // Then same day the contenteditable fix landed so `awkit-fbq` closed, and `awkit-dat` (drag-and-drop
  // not captured) was filed OPEN: net total 167 → 168, closed 158 → 159, outstanding held at 9, edges 95.
  // Then the `drag` step type landed end-to-end so `awkit-dat` closed, and `awkit-3g6` (drag designer
  // editor / mock-site / pointer-DnD follow-ups) was filed OPEN: total 168 → 169, closed 159 → 160,
  // outstanding held at 9, edges 95.
  // Then all three `awkit-3g6` parts landed (mock-site /drag-lab, designer drop-target editor,
  // pointer-emulated capture) so it closed: closed 160 → 161, outstanding 9 → 8, total held at 169.
  // Then `awkit-qpv` closed after blueprint recovery became a genuine second layer with a bounded
  // neighborhood scan: closed 161 to 162, outstanding 8 to 7, total held at 169.
  // Then `awkit-3ut` closed after framed page identity, the document-variant gate, and ancestry
  // hashing were fixed: closed 162 to 163, outstanding 7 to 6, total held at 169.
  // Then `awkit-c2z` closed after the dedicated real-browser capture/runtime blueprint gate and
  // Feature Test Lab fixture landed: closed 163 to 164, outstanding 6 to 5, total held at 169.
  // Then `awkit-utj` closed after sensitive actions were excluded from local/blueprint recovery and
  // sensitive Recorder output stopped receiving blueprint references: closed 164 to 165,
  // outstanding 5 to 4, total held at 169.
  // Then the nested-action-owner repair filed and closed `awkit-jce`: total 169 to 170 and closed
  // 165 to 166. The saturation false-positive repair `awkit-85s` then filed and closed: total
  // 170 to 171 and closed 166 to 167, while the four owner-gated outstanding items remain.
  // The roadmap portable-release disclosure awkit-402 then filed and closed: total 171 to 172 and
  // closed 167 to 168, with the same four outstanding owner-gated items.
  // The Recorder Element Identity Contract epic awkit-szp then filed and closed: total 172 to 173
  // and closed 168 to 169; the same four owner-gated items remain outstanding.
  // The independent interaction-prerequisite decision repair awkit-aek then filed and closed: total
  // 173 to 174 and closed 169 to 170; `awkit-dl7` Smart Wait causality then closed, taking the
  // tracker to 175/171 while the same four owner-gated items remain outstanding.
  // The nine-part Super User / Recorder UX / session / editor tranche `awkit-3jm` then filed and
  // The editor/Administration UI consistency task added and closed one issue after that tranche:
  // total 185 to 186, closed 181 to 182, with the same four owner-gated outstanding issues.
  // The professional rendered-evidence redesign `awkit-7le` then filed and closed one issue:
  // total 186 to 187, closed 182 to 183, with the same four owner-gated outstanding issues.
  // Complete Loop connector authoring `awkit-pwc` then filed and closed one issue:
  // total 187 to 188, closed 183 to 184; the same four owner-gated issues remain outstanding.
  // Loop reconfiguration and directional motion `awkit-kwg` then filed and closed one issue:
  // total 188 to 189, closed 184 to 185; the same four owner-gated issues remain outstanding.
  // Corrective Loop closeout added `awkit-6cg` and split its unrelated settings retry into open
  // `awkit-4qs`: total 189 to 191. The capsule-restoration verification explicitly reopened and
  // reclosed `awkit-6cg`; that left five outstanding and 186 closed, with 104 edges.
  // Deterministic multi-agent routing filed and closed `awkit-a1u` (Phases 0-4) and filed `awkit-bk3`
  // for the deferred Phase 5: total 191 to 193, closed 186 to 187, outstanding five to six.
  // Phase 5 then landed and `awkit-bk3` closed: closed 187 to 188, outstanding six back to five,
  // total unchanged at 193. `awkit-4qs` (Windows settings atomic replacement retries) then closed as
  // the routing system's first real task: closed 188 to 189, outstanding five to four. All four
  // remaining are externally blocked and owner-gated, so nothing is ready. `awkit-yeh` (router
  // writerSequence narrowing) was then filed and closed in one session: total 193 to 194, closed
  // 189 to 190, outstanding unchanged at four. `awkit-dwo` (package.json shared-write split) the
  // same way: total 194 to 195, closed 190 to 191, outstanding still four. `awkit-c6n` (Bash bypass
  // audit) likewise: total 195 to 196, closed 191 to 192, outstanding still four. `awkit-mtt`
  // (protected paths close the no-lease gap): total 196 to 197, closed 192 to 193, still four.
  // `awkit-6ab` (watched gitignored paths): total 197 to 198, closed 193 to 194, still four.
  // The Recorder hardening brief (interaction capture, multi-tab, navigation/URL tracking,
  // validation) then filed 19 issues and closed 15 of them: total 198 to 217, closed 194 to 209,
  // outstanding four to eight. `outstanding` is every non-closed status, not just `open` — the eight
  // are four `blocked` (the pre-existing owner-gated `awkit-7bu`/`az7`/`cey`/`cm8`) plus four `open`
  // (`awkit-a53k` suspected Workflow self-loop render bug, `awkit-6be` retired U-route intent,
  // `awkit-8z0` its step-2 retry, `awkit-9qj` the Recorder navigation lab). `bd stats` prints
  // "Open 4" for the same tracker; that counts only `open`, so do not pin against it.
  // Four of those closures were the flake-chain consolidation (`awkit-2js`, `awkit-7h0w`,
  // `awkit-be5o`, `awkit-r9f3` superseded by `awkit-a53k`); the fifteenth was `awkit-ty4`.
  check(
    // Then 8/210 of 218 on 2026-08-18: awkit-a53k closed (root cause was a vacuous async wait hiding
  // a real EPERM save failure, not the render fault it was filed as) and awkit-v35n filed for the
  // residual gap - one in, one out, so outstanding held while total and closed each rose by one.
  // Then 6/212 of 218 on 2026-08-18: awkit-8z0 and awkit-6be closed together when step 2 landed
  // (31 retired U-route assertions deleted, both allow-lists emptied, expectedChecks 112/58).
  // Then 5/213 of 218 on 2026-08-18: awkit-v35n closed (the capsule suites now fail on the app's own
  // save-error toast instead of waiting out a timeout).
  // Then 5/214 of 219 on 2026-08-18: awkit-9qj closed (Recorder navigation lab + regression matrix)
  // and awkit-gc0g filed for a pre-existing stale assertion the matrix run surfaced - one in, one
  // out, so outstanding held while total and closed each rose by one.
  // Then 4/215 of 219 on 2026-08-18: awkit-gc0g closed (the stale positional drop-target assertion was
  // re-expressed, not deleted, and no product code changed). All four remaining are owner-gated and
  // externally blocked - byStatus is now exactly {closed: 215, blocked: 4}, with nothing open.
  // Then 8/215 of 223 on 2026-08-18 when the full 181-verifier suite run filed five findings, then
  // 4/216 of 224 as awkit-8yp6 closed (recorder-e2e metadata parity) — the total also rose by one for
  // the reports-populated follow-up. Four remain outstanding.
  // Then 7/217 of 224 on 2026-08-18: awkit-syyd closed (protected-login count re-expressed against the
  // identical action, plus the OTP wait now gating on the attribute it asserts).
  // Then 6/218 of 224 on 2026-08-18: awkit-fbwn closed (the branding sanity check no longer demands
  // granting SuperUser the license-issuer permissions; the boundary is now the thing under test).
  // Then 5/219 of 224 on 2026-08-18: awkit-1kct closed (the reports Open-action check was a page-wide
  // ambiguous locator with a swallowed strict-mode error, not a missing button).
  // Then 4/220 of 224 on 2026-08-18: awkit-zc88 closed (the typecheck:scripts baseline repaired, 13
  // diagnostics to 0). Nothing is open — all four remaining are owner-gated and externally blocked.
  // Then 5/222 of 227 on 2026-08-18: packaging 0.1.13 surfaced three findings (awkit-joa3 hardcoded
  // artifact pin, awkit-6e2u directory-order selection, awkit-dz5w missing vendorResources); the two
  // artifact-resolution ones are fixed, awkit-dz5w remains open.
  // Then 4/223 of 227 on 2026-08-19: awkit-dz5w closed (vendorResources re-expressed against
  // electron-builder.json). Nothing is open — the four remaining are owner-gated and externally blocked.
  // Then 5/223 of 228 on 2026-08-19: the Recorder brief's two residuals were closed by adding coverage,
  // and the double-click / context-menu PRODUCT decision was filed separately as an open item.
  // Then 4/224 of 228 on 2026-08-19: awkit-bxyo closed — double-click and right-click are captured,
  // converted, persisted and replayed as dedicated `dblclick`/`contextMenu` step types, so the two
  // known-gap sentinels became positive assertions. Nothing is open; the four remaining are
  // owner-gated and externally blocked.
  // Then 5/225 of 230 on 2026-08-19: the dashboard License Issuer (awkit-96o6) was filed and closed in
  // one session, and awkit-vf9r was filed OPEN for the pre-existing duplicate issuer CLI. Two in, one
  // out, so the total rose by two, closed by one, and outstanding by one. Move this pin deliberately
  // when a bead changes state, and remember that `bd close` does NOT rewrite the export — only
  // `bd export -o .beads/issues.jsonl` does; plain `bd export` prints to STDOUT and leaves it stale.
  // Then 5/226 of 231 on 2026-08-19: awkit-xd6s filed and closed in the same session - the dashboard
  // License Issuer view had been registered in views.js, which the application imports, so the whole
  // issuer page compiled into out/renderer and shipped in the v0.1.15 artifact. One in, one out, so
  // total and closed each rose by one and outstanding held.
  // Then 9/231 of 240 on 2026-08-19: the WebDriverUniversity acceptance pass. Nine issues filed —
  // the epic `awkit-i91j`, the suite task `awkit-7p61`, five product defects (`awkit-azxy` no JS
  // dialog handling, `awkit-dctr` assertVisible never waited, `awkit-380d` counting waits capped at
  // 1, `awkit-1ugn` no attribute assertion, `awkit-omlc` goto could not choose its load condition)
  // and three honest gap trackers (`awkit-7o5n` no storage assertion, `awkit-53nb` Recorder column
  // NOT RUN, `awkit-9fvb` persistence/data/report NOT RUN). Six closed in the same session — the five
  // defects plus the suite task `awkit-7p61`, once the matrix artifact existed.
  // Net: total 231 -> 241, closed 226 -> 232, outstanding 5 -> 9. The three gap trackers and the
  // epic `awkit-i91j` stay OPEN on purpose: the Recorder layer has no evidence at all yet.
  //
  // Then 5/244 of 249 on 2026-08-20: the WebDriverUniversity acceptance pass COMPLETED. Eight
  // issues filed, all product defects found by execution — six of them by driving the real Recorder
  // against the live site (`awkit-dhdr` no press-and-hold gesture, `awkit-11ii` file chooser stored
  // as an unrunnable fill, `awkit-qlg6` the Recorder never captured a dialog, `awkit-tj2o` a drag
  // whose source follows the cursor recorded nothing, `awkit-e0z6` positional radio locators,
  // `awkit-vzhy` text locators offered to buttons and links only, `awkit-n4wr` readonly-field clicks
  // dropped, `awkit-jw46` document.write popups recorded nothing). All eight closed in the same
  // session, along with the three gap trackers (`awkit-7o5n`, `awkit-53nb`, `awkit-9fvb`) and the
  // epic `awkit-i91j`. Net: total 241 -> 249, closed 232 -> 244, outstanding 9 -> 5. The remaining
  // five are unrelated to WDU: `awkit-vf9r` plus four blocked on external systems or an owner
  // decision (`awkit-cey`, `awkit-7bu`, `awkit-az7`, `awkit-cm8`).
  // Then 4/245 of 249 on 2026-08-20: `awkit-vf9r` closed - the issuer CLI was folded onto
  // `LicenseIssuerService`, so all three front ends now share one signing authority. No new issues.
  // NOTHING is open: the remaining four are all BLOCKED on an external system or an owner decision,
  // so a zero here means "no engineering is available", not "nothing is left".
  // Then 5/246 of 251 on 2026-08-20: the Fixed-time Wait validation defect `awkit-3p6x` was filed and
  // closed the same session, and `awkit-jtok` was filed OPEN for the Smart Wait `WaitCondition`
  // structural-validation gap that fix deliberately left out of scope. So outstanding is 5 and ONE of
  // them is genuinely open engineering rather than owner-gated; the other four are still BLOCKED on an
  // external system or an owner decision, so a low number here means "little engineering is
  // available", not "nothing is left".
  // Then 4/247 of 251 the same day: `awkit-jtok` closed - the Smart Wait `WaitCondition` union is now
  // structurally validated across all 15 condition types. No new issues were filed, so outstanding
  // returns to the four owner-gated items and NOTHING is open again.
  // Then 4/248 of 252 the same day: `awkit-56un` filed AND closed - the Assert Text flat rule, wrong
  // three ways at once (the expectedValue channel, the url/storage locator, and the
  // attributeName/storageKey config). Filed and closed in one session, so outstanding held at four
  // and nothing is open.
  // Then 4/249 of 253 the same day: `awkit-njqg` filed AND closed - the Loop and Scroll flat rules,
  // which also exposed dead loop/scroll nodes in the random generator's own corpus. Filed and closed
  // in one session, so outstanding held at four and nothing is open.
  // Then 5/250 of 255 the same day: `awkit-dnbb` filed AND closed (condition nodes accepted a value
  // source the runner never resolves, routing always-true), and `awkit-9qcz` filed OPEN for the
  // FEATURE question that fix deliberately did not decide - whether a condition expression should be
  // data-driven at all. So outstanding is 5 and one of them is an open owner decision rather than an
  // external blocker. `runFlow` was checked in the same pass and needed no change.
  // Then 5/251 of 256: token-aware routing task `awkit-bkfy` filed and closed, so total and closed
  // each rose by one while outstanding stayed at five.
  // Then 6/250 of 256 on 2026-08-21: NOTHING was filed. 5+251 and 6+250 both total 256, so this was
  // one bead moving BACKWARDS across the line, not a new issue - `awkit-bkfy` was reopened and
  // claimed (`bd show awkit-bkfy` reads IN_PROGRESS, Started 2026-08-20) to carry the continuing
  // token-aware routing work, so it left `closed` and joined `outstanding`. Measured state is
  // {closed: 250, blocked: 4, open: 1 (`awkit-9qcz`), in_progress: 1 (`awkit-bkfy`)}. Note that
  // `bd stats` prints "Blocked: 0" for the same tracker - that field counts dependency-blocked
  // issues, not the `blocked` STATUS, so do not pin against it; `bd list --status blocked` shows 4.
  // Then 5/251 of 256 on 2026-08-21: the continuing token-aware routing work landed and `awkit-bkfy`
  // was re-closed, so the bead crossed BACKWARDS across the line - from `outstanding` to `closed` -
  // without any new issue being filed (total held at 256).
  // Then 4/252 of 256 on 2026-08-22: Option A landed and `awkit-9qcz` closed, again with no issue
  // filed. Measured state is {closed: 252, blocked: 4, open: 0, in_progress: 0} over 256 parsed.
  // Then 4/255 of 259: `awkit-rvb`, `awkit-rvo`, and `awkit-rvt` were filed and closed, so total
  // and closed each rose by three while the four owner-gated outstanding issues remained unchanged.
  // Then 3/256 of 259 on 2026-08-22: `awkit-cey` (REC-022) closed on executed live IdP walkthrough
  // evidence; no issue filed. Measured state is {closed: 256, blocked: 3, open: 0} over 259 parsed.
  // Then 3/257 of 260 on 2026-08-25: `awkit-uwfo` (License Issuer signing-key readiness - one
  // canonical resolver plus the five readiness states) was filed and closed in the same session, so
  // total and closed each rose by one while the three owner-gated outstanding issues held.
  // Then 4/257 of 261 on 2026-08-25: `awkit-hgol` was filed BLOCKED (release packaging cannot build
  // the portable/NSIS artifacts on this 16 GB workstation - 7-Zip -mx=9 OOM over the 802 MiB tree),
  // so the total rose by one and outstanding three to four. Resolution is an owner decision between a
  // larger build machine and a compression-policy change, so it joins the owner-gated set.
  // Then 4/258 of 262 on 2026-08-27: `awkit-final9` was filed and closed after the nine-item
  // implementation and focused campaign completed. Total and closed each rose by one; the same four
  // owner/release-gated issues remain outstanding.
  // Then 2/260 of 262 on 2026-08-29: canonical bounded-memory packaging plus the clean-machine
  // installer path closed `awkit-hgol`; current Reports evidence ownership showed `awkit-az7` was
  // stale bookkeeping, so it closed too. `awkit-7bu` and `awkit-cm8` remain externally blocked.
  // Then 2/261 of 263 on 2026-09-01: `awkit-ui0831` was filed and closed after the Flow validation,
  // Recorder Favorites and Oracle modal UX implementation and focused GUI/runtime campaign.
  // Then 2/262 of 264 on 2026-09-01: `awkit-xpathmode` added and closed the switchable Default/XPath
  // Recorder locator mode with persisted settings, round-trip/replay proof and truthful shadow limits.
  // Then 3/262 of 265 on 2026-09-01: `awkit-upnf` was filed for the independent XPath audit.
  // The audit then closed after its focused and release-gate verification campaign: 2/263 of 265.
  // Then 3/263 of 266 on 2026-09-03 when `awkit-id8i` was filed for R0 characterization, and
  // 2/264 when its 85-check mutation-backed baseline closed; the two external blockers are unchanged.
  // Then 3/264 of 267 when `awkit-2q2d` was filed for R1A, and 2/265 when its narrow injected
  // ExecutionEngine ports and 99-check characterization closed; the external blockers remain unchanged.
  // Then 2/266 of 268 on 2026-09-04: `awkit-oqvw` (R1B, one write coordinator per resolved profile
  // folder) was filed and closed in the same session, so total and closed each rose by one while the
  // two externally blocked Oracle issues `awkit-7bu` and `awkit-cm8` remain outstanding. That same
  // filing carried one `blocks` dependency on `awkit-2q2d`, taking edges 105 → 106; the export diff
  // confirms it is the only edge added and that no existing edge changed (`awkit-oqvw` ships
  // `dependency_count: 1`, and `awkit-2q2d` moved on exactly one field, `dependent_count` 0 → 1).
    "2 outstanding / 266 closed",
    beads.stats.outstanding === 2 && beads.stats.closed === 266,
    `outstanding ${beads.stats.outstanding}, closed ${beads.stats.closed}`
  );
  // WHAT THE PIN ABOVE PROTECTS AGAINST, and why it stays an exact pair rather than a range: a
  // `bd close`/`bd create` whose export was never refreshed. `bd close` does NOT rewrite
  // `.beads/issues.jsonl` - only `bd export -o .beads/issues.jsonl` does; plain `bd export` prints
  // to STDOUT and leaves the file stale. A stale export is perfectly well-formed, so no structural
  // check can see it. Move the pin deliberately when a bead changes state; never relax it.
  //
  // WHAT THE PIN CANNOT PROTECT AGAINST, and why the two checks below exist: it is satisfied by ANY
  // parse that happens to produce those two numbers - including one that silently dropped records
  // and was then re-pinned to match. Note that `outstanding + closed === total` is deliberately NOT
  // asserted: it is a tautology of parse-beads.mjs (`closed` counts status === "closed" and
  // `outstanding` counts status !== "closed"), so it could never fail and would be decoration.
  //
  // Independent recount, taken from the export TEXT rather than from the parse being checked.
  // parseBeads skips a record whose JSON is unparseable, or whose `_type` is not "issue", with only
  // a warning - so a parser that lost part of the tracker would still satisfy every `every()` and
  // every tally in this section. Capture permissively (any line declaring itself an issue record),
  // validate strictly (the parsed count must equal it exactly).
  const exportedIssueRecords = readSource("beads")
    .text.split(/\r?\n/)
    .filter((line) => /"_type"\s*:\s*"issue"/.test(line)).length;
  check(
    "every issue record in the export was parsed, none silently dropped",
    exportedIssueRecords > 0 && beads.stats.total === exportedIssueRecords,
    `parsed ${beads.stats.total}, ${exportedIssueRecords} issue records in .beads/issues.jsonl`
  );
  // Non-vacuity. Every `.every()` in this section - known status, known edge type - is trivially
  // true over an empty bead list, and the ordering, provenance and area sections downstream all
  // build on the same snapshot. An emptied, truncated or entirely-closed ledger must FAIL here
  // rather than sail through as a green run. The byStatus sum is an invariant guard for a future
  // refactor of parse-beads.mjs rather than a live discriminator; the three cardinalities are the
  // part that actually fires today.
  check(
    "the tracker has real work on both sides of the ledger",
    beads.stats.total > 0 &&
      beads.stats.closed > 0 &&
      beads.stats.outstanding > 0 &&
      Object.values(beads.stats.byStatus).reduce((sum, n) => sum + n, 0) === beads.stats.total,
    `total ${beads.stats.total}, closed ${beads.stats.closed}, outstanding ${beads.stats.outstanding}, byStatus ${JSON.stringify(beads.stats.byStatus)}`
  );
  check(
    "every status in the export is one bd actually defines",
    Object.keys(beads.stats.byStatus).every((s) => KNOWN_STATUSES.has(s)),
    JSON.stringify(beads.stats.byStatus)
  );
  check(
    "the full bd status taxonomy is accepted, not just open/closed",
    KNOWN_STATUSES.size === 7 && KNOWN_STATUSES.has("in_progress") && KNOWN_STATUSES.has("blocked"),
    "`bd update --claim` sets in_progress; rejecting it would fail this gate the first time anyone claimed work"
  );
  check("no dangling dependency reference", beads.stats.danglingEdges === 0, `got ${beads.stats.danglingEdges}`);
  check("every status is known", beads.beads.every((b) => KNOWN_STATUSES.has(b.status)));
  check(
    "106 edges are present to classify",
    beads.stats.edges === 106,
    `got ${beads.stats.edges} — the edge-type check below is vacuous if this reaches 0`
  );
  check(
    "every edge type is known",
    beads.beads.every((b) => (b.dependencies ?? []).every((d) => KNOWN_EDGE_TYPES.has(d.type))),
    "an unrecognised edge type would be silently ignored by the graph"
  );

  /* ======================================================================
     3. Ledger — reconciled four ways. The highest-value check here: it is what
        catches the campaign documents drifting apart from the case file.
     ====================================================================== */
  console.log("Validation ledger:");
  const ledger = parseLedger();
  check("the ledger parse is not degraded", ledger.degraded === false);
  check("67 cases", ledger.stats.cases === 67, `got ${ledger.stats.cases}`);
  check(
    "heading, status and priority counts agree",
    ledger.stats.cases === ledger.stats.statusLines && ledger.stats.cases === ledger.stats.priorityLines,
    `${ledger.stats.cases} / ${ledger.stats.statusLines} / ${ledger.stats.priorityLines}`
  );
  check("every status is in the allowed set", ledger.cases.every((c) => LEDGER_STATUSES.has(c.status)));
  check(
    "tally is 65 PASS / 2 NOT RUN / 0 BLOCKED",
    ledger.tally.pass === 65 && ledger.tally.notRun === 2 && ledger.tally.blocked === 0,
    `got ${ledger.tally.pass}/${ledger.tally.notRun}/${ledger.tally.blocked}`
  );
  check("statuses sum to the case count", ledger.tally.total === ledger.stats.cases);

  const narrative = parseNarrative();
  const asserted = narrative.heads.filter((h) => h.assertedTally);
  check("both narrative documents assert a tally", asserted.length === 2, `got ${asserted.length}`);
  for (const head of asserted) {
    check(
      `${head.rel} agrees with the measured tally`,
      head.assertedTally.pass === ledger.tally.pass &&
        head.assertedTally.notRun === ledger.tally.notRun &&
        head.assertedTally.blocked === ledger.tally.blocked,
      `claims ${head.assertedTally.pass}/${head.assertedTally.notRun}/${head.assertedTally.blocked}`
    );
  }

  /* ======================================================================
     4. Traceability CSV
     ====================================================================== */
  console.log("Traceability matrix:");
  const trace = parseTraceability();
  check("102 rows", trace.stats.rows === 102, `got ${trace.stats.rows}`);
  check(
    "87 PASS / 12 NOT RUN / 3 BLOCKED",
    trace.stats.pass === 87 && trace.stats.notRun === 12 && trace.stats.blocked === 3,
    `got ${trace.stats.pass}/${trace.stats.notRun}/${trace.stats.blocked}`
  );
  check("every status is allowed", trace.rows.every((r) => TRACE_STATUSES.has(r.status)));
  check(
    "statuses account for every row",
    trace.stats.pass + trace.stats.notRun + trace.stats.blocked + trace.stats.fail === trace.stats.rows
  );
  check(
    "notes survive the unescaped commas in the source",
    trace.rows.some((r) => r.notes.includes(",")),
    "a plain 6-way split would have truncated these rows instead"
  );

  /* ======================================================================
     5. Roadmap phase module, with a negative case
     ====================================================================== */
  console.log("Roadmap phase module:");
  const phasesText = readSource("phases").text;
  const phases = extractPhases(phasesText, null, 0);
  check("11 phases", phases.phases.length === 11, `got ${phases.phases.length}`);
  check(
    "phase ids are exactly A..K",
    phases.phases.map((p) => p.id).join("") === EXPECTED_PHASE_IDS,
    phases.phases.map((p) => p.id).join("")
  );
  const mangled = extractPhases("export const implementationRoadmap = [ {{{ not an array", null, 0);
  check(
    "a mangled literal is rejected rather than half-parsed",
    mangled.phases.length === 0 && mangled.warnings.length > 0,
    `got ${mangled.phases.length} phases, ${mangled.warnings.length} warnings`
  );

  // The mid-string colon property is proven against a FIXTURE, not against whichever prose phase E
  // happens to carry today. The old form asserted the live note contained "Remaining:", so ordinary
  // rewording of a note broke a parser check that had nothing to do with the wording.
  const syntheticPhase = (status) =>
    [
      "export const implementationRoadmap: RoadmapPhase[] = [",
      "  {",
      '    id: "A",',
      '    title: "Synthetic",',
      `    status: ${JSON.stringify(status)},`,
      '    deliverables: ["one"],',
      '    acceptance: "n/a",',
      '    implementationNote: "Shipped: yes. Remaining: a named gap."',
      "  }",
      "];"
    ].join("\n");

  const syntheticPartial = extractPhases(syntheticPhase("partially-completed"), null, 0);
  check(
    "a mid-string 'Word:' inside a note does not corrupt the parse",
    syntheticPartial.phases.length === 1 &&
      syntheticPartial.phases[0].implementationNote === "Shipped: yes. Remaining: a named gap.",
    "a naive key-quoting regex quotes 'Shipped' and 'Remaining' mid-string and invalidates the JSON"
  );
  check(
    "partially-completed is an accepted phase status",
    syntheticPartial.warnings.every((w) => !/unrecognised status/.test(w)),
    syntheticPartial.warnings.join(" | ")
  );
  // Proves the line above is not vacuous: the unrecognised-status path must actually fire.
  check(
    "an unknown phase status still warns",
    extractPhases(syntheticPhase("mostly-done"), null, 0).warnings.some((w) =>
      /unrecognised status "mostly-done"/.test(w)
    ),
    "if this never fires, the accepted-status check above proves nothing"
  );
  check(
    "a partially-completed phase is counted separately and credited no completion",
    syntheticPartial.summary.partiallyCompleted === 1 &&
      syntheticPartial.summary.complete === 0 &&
      syntheticPartial.summary.completionPercent === 0,
    `partial=${syntheticPartial.summary.partiallyCompleted} complete=${syntheticPartial.summary.complete} pct=${syntheticPartial.summary.completionPercent}`
  );
  check(
    "a partially-completed phase normalises to active, never done",
    normalizePhases(syntheticPartial.phases, 0)[0]?.status === "active",
    "mapping it to done would count an unclosed phase as finished work"
  );
  // Live-data guards. Cardinality first, so neither `every` can pass over an empty list.
  check(
    "all 11 live phase notes parsed non-empty",
    phases.phases.length === 11 && phases.phases.every((p) => p.implementationNote.length > 0),
    "a silently truncated string value would leave a phase with no note"
  );
  check(
    "no live phase carries an unrecognised status",
    phases.warnings.every((w) => !/unrecognised status/.test(w)),
    phases.warnings.join(" | ")
  );

  /* ======================================================================
     6. Ordering, including the cycle branch that has no real instances today
     ====================================================================== */
  console.log("Ordering:");
  const snapshot = buildSnapshot({ now: NOW });
  const order = snapshot.order;
  const ranks = order.ordered.map((o) => o.rank).filter((r) => r !== null);
  check(
    "rank is a gapless 1..N permutation",
    ranks.length === order.stats.ranked &&
      new Set(ranks).size === ranks.length &&
      Math.min(...ranks) === 1 &&
      Math.max(...ranks) === ranks.length,
    `n=${ranks.length} min=${Math.min(...ranks)} max=${Math.max(...ranks)}`
  );
  check(
    "every ready item has zero open blockers",
    order.ordered.filter((o) => o.state === "ready").every((o) => o.openBlockers.length === 0)
  );
  check(
    "every blocked item is blocked for a stated reason",
    order.ordered
      .filter((o) => o.state === "blocked")
      .every((o) => o.openBlockers.length > 0 || o.declaredBlocked === true),
    "either an edge names the blocker, or the tracker declared the status — never neither"
  );
  check(
    "a declared-blocked issue is never offered as ready",
    order.ordered.filter((o) => o.declaredBlocked).every((o) => o.state === "blocked"),
    "awkit-7bu said BLOCKED in its title for a day while the queue ranked it startable"
  );
  // Five today (2026-07-29, down from seven): the three owner-decision items were decided and built,
  // so only externally-gated work remains — two authorized-operator gates (`awkit-7bu` real Oracle,
  // `awkit-cey` real IdP), the Oracle external release gates (`awkit-cm8`), and the two Reports OS
  // shell launches grouped under `awkit-az7`. None of the four can be represented by a normal `blocks` edge,
  // hence declared status. The layer assertion is `.every()`, not `[0]`; the cardinality guard
  // prevents vacuous success if blocked items disappear from parsing.
  // Then 3 on 2026-08-22: `awkit-cey` CLOSED on executed live IdP walkthrough evidence, leaving the
  // three owner-gated items (`awkit-7bu`, `awkit-az7`, `awkit-cm8`).
  // Then 4 on 2026-08-25: `awkit-hgol` joined them - release packaging cannot build the portable/NSIS
  // artifacts on this workstation (7-Zip -mx=9 OOM over the 802 MiB tree, reproduced three times).
  // It is declared rather than edge-blocked for the same reason as the others: no `blocks` edge can
  // express "needs a build machine with more free memory, or an owner decision on compression".
  // Then 2 on 2026-08-29: `awkit-hgol` closed on canonical package + clean-machine evidence, and
  // stale Reports bookkeeping item `awkit-az7` closed after its current NOT RUN ownership was
  // re-derived. The real Oracle/operator/soak items remain declared blocked.
  check(
    "every declared-blocked issue is present and out of the layers",
    order.stats.declaredBlocked === 2 &&
      order.externallyBlocked.length === 2 &&
      order.externallyBlocked.every((id) => order.ordered.find((o) => o.id === id)?.layer === null),
    `declaredBlocked ${order.stats.declaredBlocked}, externallyBlocked ${order.externallyBlocked.length}`
  );
  check(
    "an open blocker is itself queued",
    order.ordered.every((o) => o.openBlockers.every((b) => order.ordered.some((x) => x.id === b)))
  );
  check("no cycles in the real data", order.stats.cycles === 0, `got ${order.stats.cycles}`);
  check(
    "the caveat counts agree with the edges",
    order.caveat.withDeclaredDeps + order.caveat.withoutDeclaredDeps === order.caveat.openTotal &&
      order.caveat.openTotal === order.stats.queued
  );

  // The cycle branch must be proven to fire. A guard with no test and no real instances is
  // decoration: it would be deleted or broken by a refactor and nothing would notice.
  const synthetic = [
    makeIssue("bead:cycle-a", ["bead:cycle-b"]),
    makeIssue("bead:cycle-b", ["bead:cycle-a"]),
    makeIssue("bead:free", [])
  ];
  const cycleOrder = computeOrder(synthetic);
  check("a synthetic 2-cycle produces one cycle group", cycleOrder.cycles.length === 1, `got ${cycleOrder.cycles.length}`);
  check(
    "cycle members carry rank null and state cycle",
    cycleOrder.ordered
      .filter((o) => o.id !== "bead:free")
      .every((o) => o.rank === null && o.state === "cycle"),
    JSON.stringify(cycleOrder.ordered.map((o) => [o.id, o.rank, o.state]))
  );
  check(
    "an item outside the cycle is still ranked",
    cycleOrder.ordered.find((o) => o.id === "bead:free")?.rank === 1
  );

  // Statuses with no instance in the repository today. Each collapsed into plain "open" before this
  // was fixed, so a claimed or deferred issue was offered as ready work.
  check(
    "in_progress normalises to active and stays in the queue",
    normalizeBeadStatus("in_progress") === "active" &&
      computeOrder([{ ...makeIssue("bead:claimed", []), status: "active" }]).stats.queued === 1,
    "`bd update --claim` sets in_progress; claimed work must remain visible, not vanish"
  );
  check(
    "deferred is excluded from the queue entirely",
    normalizeBeadStatus("deferred") === "deferred" &&
      computeOrder([{ ...makeIssue("bead:iced", []), status: "deferred" }]).stats.queued === 0
  );
  check(
    "a DEFERRED prerequisite blocks its dependent (fail closed)",
    (() => {
      const o = computeOrder([
        { ...makeIssue("bead:iced", []), status: "deferred" },
        makeIssue("bead:waiting", ["bead:iced"])
      ]);
      const waiting = o.ordered.find((x) => x.id === "bead:waiting");
      return waiting?.state === "blocked" && waiting.openBlockers.includes("bead:iced");
    })(),
    "treating 'not in the queue' as satisfied would mark an item ready because its blocker was put on ice"
  );
  check(
    "a dependent of a declared-blocked issue is blocked too, and not called a cycle",
    (() => {
      const o = computeOrder([
        { ...makeIssue("bead:stuck", []), status: "blocked" },
        makeIssue("bead:downstream", ["bead:stuck"])
      ]);
      return (
        o.cycles.length === 0 &&
        o.externallyBlocked.length === 2 &&
        o.ordered.every((x) => x.state === "blocked")
      );
    })(),
    "Kahn cannot drain either one; Tarjan must separate 'held from outside' from 'circular'"
  );

  /* ======================================================================
     7. Determinism
     ====================================================================== */
  console.log("Determinism:");
  const a = JSON.stringify(buildSnapshot({ now: NOW }));
  const b = JSON.stringify(buildSnapshot({ now: NOW }));
  check("two builds from identical input are byte-identical", a === b, `${a.length} vs ${b.length} bytes`);

  /* ======================================================================
     8. Honesty invariants — the provenance rules, asserted rather than assumed
     ====================================================================== */
  console.log("Provenance:");
  // Driven against a fixture, not the shipped file. assignments.json normally ships with zero
  // claims, so asserting over "items that have an assignee" would be an .every() on an empty array
  // — true without testing anything, and it would stay true if the field stopped working entirely.
  const fixture = join(tmpdir(), `awkit-roadmap-claims-${process.pid}.json`);
  writeFileSync(
    fixture,
    JSON.stringify({
      claims: [
        { itemId: "bead:awkit-7lj", agent: "Claude", state: "in-progress", claimedAt: "2026-07-27T10:00:00Z" },
        { itemId: "bead:awkit-cxa", agent: "Codex", state: "in-progress", claimedAt: "2026-07-20T10:00:00Z", expiresAt: "2026-07-21T10:00:00Z" }
      ]
    })
  );
  const claimed = readAssignments(NOW, fixture);
  rmSync(fixture, { force: true });
  check("two fixture claims are read", claimed.stats.claims === 2, `got ${claimed.stats.claims}`);
  check(
    "every assignee is sourced to assignments.json",
    claimed.claims.size === 2 && [...claimed.claims.values()].every((c) => c.source === "assignments.json"),
    "an assignee is an authoritative claim; nothing derived may populate it"
  );
  check(
    "an expired claim is marked expired, not silently dropped",
    claimed.claims.get("bead:awkit-cxa")?.expired === true && claimed.stats.expired === 1,
    "a stale claim shown as current is worse than no claim"
  );
  check("an unexpired claim is not marked expired", claimed.claims.get("bead:awkit-7lj")?.expired === false);
  // The hazard is a STALE claim, not a claim. assignments.json exists precisely so an agent can
  // record sustained work, and the dashboard renders that as an Assignee chip; requiring the shipped
  // file to be empty made the feature unusable, because any honest claim failed this gate. Worse, the
  // only way to satisfy it was to delete another agent's live claim - which causes exactly the
  // misattribution the file was added to prevent. Assert what actually matters: nothing shipped is
  // already expired.
  const shipped = readAssignments(NOW);
  check(
    "no EXPIRED claim is shipped in the claims file",
    shipped.stats.expired === 0,
    `tools/roadmap/assignments.json ships ${shipped.stats.claims} claim(s), ${shipped.stats.expired} expired; a stale claim misattributes work`
  );
  const withActivity = snapshot.items.filter((i) => i.areaActivity);
  check("derived activity exists to test", withActivity.length > 0);
  check(
    "every derived activity is labelled task-log and derived",
    withActivity.every((i) => i.areaActivity.source === "task-log" && i.areaActivity.confidence === "derived")
  );
  check(
    "no task-log attribution sets a claim state",
    withActivity.every((i) => i.areaActivity.state === undefined),
    "a past-tense log entry must never be able to look like an active claim"
  );
  check(
    "every link declares a confidence",
    snapshot.links.links.every((l) => typeof l.confidence === "string" && l.confidence.length > 0)
  );
  check(
    "at least one cited id is unresolved and preserved",
    snapshot.links.stats.unresolvedTokens >= 1,
    "CMP-CON-002 proves the Detected by join is lossy; if this reaches 0 the honest path is untested"
  );
  check(
    "every area carries a confidence and a basis",
    snapshot.items.every((i) => i.area && typeof i.area.confidence === "string" && typeof i.area.basis === "string")
  );

  // Area weighting. Every case below returned the WRONG value before the weighting fix, when title
  // and body were concatenated into one haystack and the keyword list's own order decided.
  check(
    "a title keyword outranks a body keyword",
    deriveAreaWeighted("Settings full-page coverage", "extends verify:recorder-gui", "title", "description").value ===
      "Settings",
    "a Settings issue was filed under Recorder because its body cited a recorder verifier"
  );
  check(
    "the earliest keyword in a scope wins, not the first in the keyword list",
    deriveAreaWeighted("Settings coverage: unavailable secret-store GUI", "", "title", "description").value ===
      "Settings",
    "`secret` precedes `settings` in the keyword table; position must decide, not list order"
  );
  check(
    "a body keyword is still used when the title is silent",
    deriveAreaWeighted("Phase 4 follow-up", "the popup registration path", "title", "description").value ===
      "Runner / engine"
  );
  check(
    "the body's basis says the title was silent",
    deriveAreaWeighted("Phase 4 follow-up", "the popup path", "title", "description").basis.includes(
      "no keyword in title"
    ),
    "a weaker signal must announce itself"
  );
  check(
    "no keyword anywhere stays unclassified rather than guessing",
    deriveAreaWeighted("Phase 4 follow-up", "nothing recognisable", "title", "description").value === null
  );
  check(
    "the five Test Lab issues are all filed under Test Lab",
    snapshot.items.filter((i) => i.nativeId.startsWith("awkit-wza.")).every((i) => i.area.value === "Test Lab"),
    "they were scattered across Reports, Licensing and Security by body keywords"
  );
  check(
    "the consistency banner checked something",
    snapshot.consistency.checked >= 2,
    `checked ${snapshot.consistency.checked}`
  );

  // `checked >= 2` above proves the banner looked at something; it passes whether or not those
  // sources agree. AGENTS.md requires the Overview banner to read "Sources agree", and until
  // 2026-08-21 no gate asserted that — the banner could render "Sources disagree" with this
  // verifier fully green. `agrees` is the exact boolean views.js renders the banner from
  // (tools/roadmap/lib/model.mjs: copies.every(c => c.agrees) && staleClaims.length === 0), so
  // assert it directly rather than re-deriving a copy of the predicate here. Both halves are
  // asserted separately below so a failure names which one broke.
  const disagreeingCopies = snapshot.consistency.copies.filter((c) => !c.agrees);
  check(
    "no narrative copy of the ledger tally disagrees with the measured one",
    disagreeingCopies.length === 0,
    disagreeingCopies
      .map((c) => `${c.rel} asserts ${c.tally.pass}/${c.tally.notRun}/${c.tally.blocked}`)
      .join("; ")
  );
  check(
    "no stale ledger claim is live in the tracker",
    snapshot.consistency.staleClaims.length === 0,
    snapshot.consistency.staleClaims
      .map((s) => `${s.itemId} claims ${s.claimed} for ${s.area}, ledger measures ${s.measured}`)
      .join("; ")
  );
  check(
    'the Overview banner reads "Sources agree"',
    snapshot.consistency.agrees === true,
    `consistency.agrees is ${snapshot.consistency.agrees}: ${disagreeingCopies.length} of ` +
      `${snapshot.consistency.copies.length} copies disagree and ` +
      `${snapshot.consistency.staleClaims.length} stale claims are live`
  );

  /* ======================================================================
     9. Server
     ====================================================================== */
  console.log("Server:");
  process.env.ROADMAP_PORT = "0"; // ephemeral: never collide with a dashboard the owner is running
  const { server, setPortableBuildProcessFactoryForTests } = await import("../tools/roadmap/server.mjs");
  let portableInvocation = 0;
  setPortableBuildProcessFactoryForTests(() => {
    portableInvocation += 1;
    const exitCode = portableInvocation === 1 ? 0 : 7;
    // The second (failing) run emits a [STEP] marker first, exercising the progress parser's
    // line buffering and step advance against a real child stdout stream.
    const script =
      portableInvocation === 1
        ? `setTimeout(() => process.exit(0), 80)`
        : `console.log('[STEP]  synthetic packaging step'); setTimeout(() => process.exit(7), 80)`;
    return spawn(process.execPath, ["-e", script], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
  });
  await new Promise((resolve) => (server.listening ? resolve() : server.once("listening", resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const snapRes = await fetch(`${base}/api/snapshot`);
  const etag = snapRes.headers.get("ETag");
  const payload = await snapRes.json();
  check("/api/snapshot returns 200", snapRes.status === 200, `got ${snapRes.status}`);
  check("/api/snapshot sends an ETag", typeof etag === "string" && etag.length > 0);
  check(
    "the payload carries every top-level section",
    ["items", "order", "links", "consistency", "ledger", "defects", "traceability", "phases", "sources", "stats"].every(
      (key) => key in payload
    )
  );
  const revalidated = await fetch(`${base}/api/snapshot`, { headers: { "If-None-Match": etag } });
  check("a matching If-None-Match returns 304", revalidated.status === 304, `got ${revalidated.status}`);

  const events = await fetch(`${base}/api/events`);
  check(
    "/api/events is an event stream",
    (events.headers.get("Content-Type") ?? "").startsWith("text/event-stream"),
    events.headers.get("Content-Type") ?? "none"
  );
  await events.body.cancel();

  const cssRes = await fetch(`${base}/app.css`);
  const cssBody = await cssRes.arrayBuffer();
  const cssOnDisk = statSync(sourcePath("globalCss")).size;
  check(
    "/app.css serves global.css byte-for-byte",
    cssBody.byteLength === cssOnDisk,
    `served ${cssBody.byteLength}, on disk ${cssOnDisk}`
  );

  const notFound = await fetch(`${base}/../package.json`);
  check("an unlisted path is 404", notFound.status === 404, `got ${notFound.status}`);
  const notAllowed = await fetch(`${base}/api/refresh`);
  check("GET /api/refresh is rejected", notAllowed.status === 405, `got ${notAllowed.status}`);

  const initialBuildRes = await fetch(`${base}/api/package-portable`);
  const initialBuild = await initialBuildRes.json();
  const packageVersion = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).version;
  const versionMatch = packageVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const expectedNextVersion = versionMatch ? `${versionMatch[1]}.${versionMatch[2]}.${Number(versionMatch[3]) + 1}` : null;
  check(
    "portable build status starts idle with patch-release policy",
    initialBuildRes.status === 200 && initialBuild.state === "idle" && initialBuild.versionPolicy === "patch"
  );
  check(
    "portable build status discloses the main release base and patch target",
    initialBuild.releaseTarget?.branch === "main" &&
      /^[0-9a-f]{40}$/i.test(initialBuild.releaseTarget?.commit ?? "") &&
      initialBuild.releaseTarget?.currentVersion === packageVersion &&
      initialBuild.releaseTarget?.nextVersion === expectedNextVersion,
    JSON.stringify(initialBuild.releaseTarget)
  );

  const unauthorizedBuild = await fetch(`${base}/api/package-portable`, { method: "POST" });
  check("portable build rejects a form-compatible POST", unauthorizedBuild.status === 403, `got ${unauthorizedBuild.status}`);

  const foreignOriginBuild = await fetch(`${base}/api/package-portable`, {
    method: "POST",
    headers: {
      Origin: "https://example.invalid",
      "X-AWKIT-Roadmap-Action": "package-portable"
    }
  });
  check("portable build rejects a foreign Origin", foreignOriginBuild.status === 403, `got ${foreignOriginBuild.status}`);

  const actionHeaders = { "X-AWKIT-Roadmap-Action": "package-portable" };
  const startedBuildRes = await fetch(`${base}/api/package-portable`, { method: "POST", headers: actionHeaders });
  const startedBuild = await startedBuildRes.json();
  check(
    "portable build starts through the fixed action",
    startedBuildRes.status === 202 && startedBuild.build?.state === "running",
    `status ${startedBuildRes.status}, state ${startedBuild.build?.state}`
  );

  const duplicateBuild = await fetch(`${base}/api/package-portable`, { method: "POST", headers: actionHeaders });
  check("a concurrent portable build is rejected", duplicateBuild.status === 409, `got ${duplicateBuild.status}`);

  let finalBuild = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fetch(`${base}/api/package-portable`);
    finalBuild = await response.json();
    if (finalBuild.state !== "running") break;
  }
  check("portable build completion is observable", finalBuild?.state === "succeeded", finalBuild?.state ?? "none");
  check(
    "portable build exposes only a repo-relative EXE result",
    /^dist\/[^/\\]+\.exe$/.test(finalBuild?.artifact ?? ""),
    finalBuild?.artifact ?? "none"
  );
  check(
    "portable build status does not expose command details",
    !["command", "args", "cwd", "environment", "output"].some((key) => key in (finalBuild ?? {}))
  );

  const failedBuildStart = await fetch(`${base}/api/package-portable`, { method: "POST", headers: actionHeaders });
  check("a completed build can be retried", failedBuildStart.status === 202, `got ${failedBuildStart.status}`);
  let failedBuild = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fetch(`${base}/api/package-portable`);
    failedBuild = await response.json();
    if (failedBuild.state !== "running") break;
  }
  check(
    "portable build failure is observable with its exit code",
    failedBuild?.state === "failed" && failedBuild.exitCode === 7,
    `${failedBuild?.state ?? "none"}/${failedBuild?.exitCode ?? "none"}`
  );
  check("a failed build never claims an artifact", failedBuild?.artifact === null, String(failedBuild?.artifact));

  // Progress contract: the succeeded run completed all steps; the failing run advanced exactly one
  // step (its [STEP] line) and froze there with only step/total/label exposed.
  check(
    "a succeeded portable build reports full progress",
    finalBuild?.progress?.step === 15 && finalBuild?.progress?.total === 15,
    JSON.stringify(finalBuild?.progress)
  );
  check(
    "a failed portable build freezes at the step that emitted [STEP]",
    failedBuild?.progress?.step === 1 &&
      failedBuild?.progress?.total === 15 &&
      failedBuild?.progress?.label === "synthetic packaging step",
    JSON.stringify(failedBuild?.progress)
  );
  check(
    "portable build progress exposes only step/total/label",
    Object.keys(failedBuild?.progress ?? {}).sort().join(",") === "label,step,total",
    JSON.stringify(Object.keys(failedBuild?.progress ?? {}))
  );

  // The dashboard page ships the progress bar the build status drives.
  const indexHtml = readFileSync(join(ROADMAP_ROOT, "public", "index.html"), "utf8");
  check(
    "the dashboard page ships the portable-build progress bar",
    indexHtml.includes('id="rm-build-progress"') && indexHtml.includes('role="progressbar"')
  );

  const unsupportedBuildMethod = await fetch(`${base}/api/package-portable`, { method: "PUT" });
  check("unsupported portable build methods are rejected", unsupportedBuildMethod.status === 405);

  server.close();

  /* ======================================================================
     10. Offline rules
     ====================================================================== */
  console.log("Offline:");
  const publicDir = join(ROADMAP_ROOT, "public");
  const assets = readdirSync(publicDir);
  check("the page has its assets", assets.length >= 6, assets.join(", "));
  // The SVG and XHTML namespace URIs are identifiers passed to createElementNS, not addresses —
  // nothing is ever fetched from them. They are removed before the scan so the check stays a real
  // test of "does this page reach the network" rather than a string match that has to be waived.
  const NAMESPACE_URIS = /https?:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink)/g;
  for (const file of assets) {
    const text = readFileSync(join(publicDir, file), "utf8");
    check(`${file} has no remote URL`, !/https?:\/\//.test(text.replace(NAMESPACE_URIS, "")));
    check(`${file} has no @import url(`, !/@import\s+url\(/.test(text));
  }
  const indexSrc = readFileSync(join(publicDir, "index.html"), "utf8");
  const dashboardSrc = readFileSync(join(publicDir, "dashboard.js"), "utf8");
  const serverSrc = readFileSync(join(ROADMAP_ROOT, "server.mjs"), "utf8");
  const releaseScriptSrc = readFileSync(join(REPO_ROOT, "scripts", "release-portable.ps1"), "utf8");
  check(
    "the next-version portable action is visible in the dashboard shell",
    indexSrc.includes('id="rm-package-portable"') &&
      indexSrc.includes("Generate next portable EXE") &&
      indexSrc.includes('id="rm-release-target"')
  );
  check(
    "the portable action discloses the release base, patch bump, and CSRF-resistant header",
    dashboardSrc.includes("window.confirm(") &&
      dashboardSrc.includes("Release base:") &&
      dashboardSrc.includes("releaseTarget") &&
      dashboardSrc.includes("increments the patch version") &&
      dashboardSrc.includes("latest clean main commit") &&
      dashboardSrc.includes("without predefined users") &&
      dashboardSrc.includes('"X-AWKIT-Roadmap-Action": "package-portable"')
  );
  check(
    "the server fixes the patch-release script and disables shell interpretation",
    serverSrc.includes('const PACKAGE_SCRIPT = join(REPO_ROOT, "scripts", "release-portable.ps1")') &&
      serverSrc.includes('const RELEASE_VERSION_POLICY = "patch"') &&
      serverSrc.includes('"-BumpType"') &&
      serverSrc.includes('"-Force"') &&
      serverSrc.includes("shell: false") &&
      !serverSrc.includes("url.searchParams")
  );
  check(
    "the release wrapper refuses dirty work and never stages unrelated files or skips hooks",
    releaseScriptSrc.includes("status --porcelain --untracked-files=all") &&
      releaseScriptSrc.includes("git add -- package.json package-lock.json") &&
      releaseScriptSrc.includes("git add -- resources/dependency-manifest.json resources/dependency-manifest.sig") &&
      releaseScriptSrc.includes('Join-Path $ScriptsDir "package-portable.ps1"') &&
      !releaseScriptSrc.includes("git add -A") &&
      !releaseScriptSrc.includes("--no-verify")
  );
  const packageScriptSrc = readFileSync(join(REPO_ROOT, "scripts", "package-portable.ps1"), "utf8");
  check(
    "portable packaging rejects insufficient Windows commit before electron-builder starts",
    hasPortableCommitHeadroomGuard(packageScriptSrc),
    "the old pipeline reaches 7za.exe and fails as an opaque NSIS child-process error"
  );
  check(
    "the portable commit-headroom assertion kills the old unchecked pipeline",
    !hasPortableCommitHeadroomGuard(
      packageScriptSrc.replaceAll("\nAssert-PackagingCommitHeadroom\n", "\n# commit-headroom check removed\n")
    )
  );
  const successfulHeadroomProbe = probePortableCommitHeadroomSuccess(packageScriptSrc);
  check(
    "portable packaging renders the successful commit-headroom preflight",
    successfulHeadroomProbe.ok,
    successfulHeadroomProbe.detail
  );
  const brokenSuccessfulMessage = packageScriptSrc
    .replace("$preflightMessage = (", "Write-Host (")
    .replace("\n    Write-Host $preflightMessage", "");
  const brokenHeadroomProbe = probePortableCommitHeadroomSuccess(brokenSuccessfulMessage);
  check(
    "the successful commit-headroom probe kills the old Write-Host formatting",
    !brokenHeadroomProbe.ok,
    "the old formatting unexpectedly executed successfully"
  );
  check(
    "portable release cleanup preserves the child packaging exit code",
    preservesPortableChildExitCode(releaseScriptSrc),
    "Restore-GeneratedReleaseFiles currently overwrites $LASTEXITCODE with git restore's success code"
  );
  check(
    "the portable release exit-code assertion kills the old cleanup ordering",
    !preservesPortableChildExitCode(
      releaseScriptSrc.replace("$packageExitCode = $LASTEXITCODE", "$packageExitCode = 0")
    )
  );
  check(
    "the dashboard release pipeline rejects bundled databases and proves first-run Super User setup",
    packageScriptSrc.includes("npm run verify:portable-fresh-state") &&
      packageScriptSrc.indexOf("npm run verify:portable-fresh-state") < packageScriptSrc.indexOf("generate-dependency-manifest.ps1")
  );
  check(
    "a stale same-route server is rejected when it lacks patch-release capability",
    dashboardSrc.includes('build?.versionPolicy !== "patch"') &&
      dashboardSrc.includes("ROADMAP_SERVER_RESTART_MESSAGE")
  );
  check(
    "the API decoder preserves valid JSON",
    JSON.stringify(await readApiPayload(new Response('{"ok":true}'))) === '{"ok":true}'
  );
  check(
    "a stale server's plain-text 404 becomes an actionable restart message",
    (await readApiPayload(new Response("Not found", { status: 404 }))).error === ROADMAP_SERVER_RESTART_MESSAGE
  );
  check(
    "a non-JSON server error does not expose its raw body",
    (await readApiPayload(new Response("Internal error: C:\\private\\path", { status: 500 }))).error ===
      "Request failed (HTTP 500)."
  );
  // icon() falls back to ICON_NODES.circle for a name it does not know, so a typo or a status added
  // without its icon renders a plain circle and nothing fails. Resolve every referenced name here.
  const viewsSrc = readFileSync(join(publicDir, "views.js"), "utf8");
  const iconsSrc = readFileSync(join(publicDir, "icons.js"), "utf8");
  const definedIcons = new Set(
    [...iconsSrc.matchAll(/^ {2}"?([a-z][a-z0-9-]*)"?:\s*\[/gm)].map((m) => m[1])
  );
  const statusIconBlock = /const statusIcon = \{([\s\S]*?)\};/.exec(viewsSrc)?.[1] ?? "";
  // Capture ANY string content, not [a-z0-9-]+. A restrictive class silently skips the malformed
  // name instead of collecting it, so the membership test below would never see a typo — the check
  // would pass precisely when it was needed. (Verified by mutation: "circle-dashedX" must fail.)
  const referencedIcons = [
    ...[...viewsSrc.matchAll(/\b(?:icon|iconSpan|statCard)\(\s*"([^"]*)"/g)].map((m) => m[1]),
    ...[...statusIconBlock.matchAll(/:\s*"([^"]*)"/g)].map((m) => m[1])
  ];
  check(
    "the icon-name scan actually found names to resolve",
    definedIcons.size >= 20 && referencedIcons.length >= 10,
    `${definedIcons.size} defined, ${referencedIcons.length} referenced`
  );
  check(
    "every icon name views.js references is defined in icons.js",
    referencedIcons.every((name) => definedIcons.has(name)),
    referencedIcons.filter((name) => !definedIcons.has(name)).join(", ") || "-"
  );
  check(
    "every phase status maps to its own icon",
    ["complete", "in-progress", "partially-completed", "pending", "blocked"].every((s) =>
      new RegExp(`"?${s}"?:\\s*"`).test(statusIconBlock)
    ),
    statusIconBlock.trim()
  );
  check(
    "partially-completed renders a label, not its raw hyphenated value",
    /"partially-completed"\)\s*return\s*"Partially completed"/.test(viewsSrc.replace(/\s+/g, " ")),
    "the generic title-case path would render 'Partially-completed'"
  );
  check(
    "no asset builds markup with innerHTML",
    assets.every((f) => !/\.innerHTML\s*=/.test(readFileSync(join(publicDir, f), "utf8"))),
    "every string rendered here comes from repository prose and must be assigned as text"
  );

  /* ======================================================================
     11. The borrowed application classes still exist
     ====================================================================== */
  console.log("Borrowed application classes:");
  const globalCss = readSource("globalCss").text;
  const borrowed = [
    "app-shell",
    "app-main",
    "top-header",
    "left-navigation",
    "brand-block",
    "brand-tile",
    "nav-item",
    "nav-footer",
    "navigation-list",
    "work-panel",
    "section-heading",
    "page",
    "roadmap-grid",
    "roadmap-card",
    "roadmap-summary-grid",
    "roadmap-next-panel",
    "roadmap-card-header",
    "roadmap-deliverables",
    "roadmap-acceptance",
    // Phase status modifiers. The dashboard sets `roadmap-card <rawStatus>` and
    // `roadmap-status <rawStatus>` verbatim from the source file, so a status with no rule renders
    // as an unstyled chip rather than failing.
    "roadmap-status.complete",
    "roadmap-status.in-progress",
    "roadmap-status.partially-completed",
    "roadmap-status.pending",
    "roadmap-status.blocked",
    "roadmap-card.partially-completed"
  ];
  for (const name of borrowed) {
    check(
      `.${name} is still defined in global.css`,
      new RegExp(`\\.${name}[\\s.,:{>[]`).test(globalCss),
      "the dashboard reuses this rule; a rename would degrade the page silently"
    );
  }
  check(
    ".nav-item.active is the modifier the dashboard sets",
    /\.nav-item\.active[\s,{]/.test(globalCss),
    "dashboard.js applies `active`; if global.css renames it the nav loses its selected state"
  );
} catch (error) {
  failed += 1;
  console.error(error);
}

console.log(`\n${passed}/${passed + failed} roadmap dashboard checks passed`);
process.exit(failed === 0 ? 0 : 1);

/** A minimal open issue, shaped like normalize.mjs output, for the synthetic cycle. */
function makeIssue(id, dependsOn) {
  return {
    id,
    nativeId: id,
    kind: "issue",
    title: id,
    status: "open",
    rawStatus: "open",
    priority: 1,
    rawPriority: "P1",
    type: "bug",
    area: { value: null, confidence: "derived", basis: "synthetic" },
    dependsOn,
    blocks: [],
    related: [],
    evidence: [],
    source: { file: "synthetic", line: 0, sourceId: "synthetic" },
    updatedAt: null,
    body: "",
    flags: {}
  };
}
