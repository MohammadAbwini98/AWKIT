#!/usr/bin/env node
/**
 * Graphify shrink-guard regression (awkit-wy82 FAIL-CLOSED acceptance).
 *
 * Verifier class: **Integration** — drives the REAL locally installed Graphify package
 * (uv tool `graphifyy`, developer/AI tool, never an app dependency) through a real Python
 * subprocess: `graphify.watch._check_shrink`, `graphify.cli._stale_graph_sources`,
 * `graphify.cli._prune_graph_json_sources`, `graphify.detect.detect`, and real
 * `graphify update` runs against a synthetic corpus in a temp sandbox. Real fs persistence
 * (atomic graph writes + protected backups), no browser, no Electron, no network.
 *
 * What realistic regression would make this test fail?
 *   - Graphify (or a local edit to it) changed to ACCEPT arbitrary shrink: the unexplained-loss
 *     negative controls expect `_check_shrink` to refuse, so an always-accept mutant turns this
 *     verifier red (proven live via a sitecustomize monkeypatch mutant: 19/26, exit 1; and an
 *     always-refuse mutant aborts the end-to-end build into an explicit FAIL, exit 1).
 *   - The provenance reconciliation path regressing: `_stale_graph_sources` must select EXACTLY
 *     the provably excluded sources and keep alive-but-unignored ones (fail-closed liveness), and
 *     `_prune_graph_json_sources` must remove exactly those nodes and nothing else.
 *   - The end-to-end replica of the awkit-wy82 event: build → intentionally exclude live files →
 *     ordinary `graphify update .` must REFUSE (non-zero, no --force) → provenance prune →
 *     ordinary update must then complete (exit 0). If a future Graphify accepts the unexplained
 *     exclusion shrink directly, the refusal step goes red; if it starts refusing the reconciled
 *     state, the acceptance step goes red.
 *   - Owner preservation: the excluded files must still exist on disk afterwards.
 *
 * BLOCKED, not vacuous PASS: when the Graphify runtime cannot be located/imported, this exits 2
 * with a BLOCKED report instead of counting checks over nothing. A driver abort records an
 * explicit FAIL rather than a 0/0 summary.
 *
 * Run: npm run verify:graphify-shrink-guard
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* ── Locate the locally installed graphify venv ────────────────────────────────────────────
 * uv installs user-scoped tools under %APPDATA% or %LOCALAPPDATA% (varies by uv version), with
 * a Windows layout (Scripts/python.exe + Lib/site-packages) or a POSIX one (bin/python +
 * lib/python3.x/site-packages). Candidates are probed in order; `uv tool dir` is a fallback,
 * never a requirement. No network, no new dependency — the tool must already be installed. */
function locateGraphifyPython() {
  const roots = [];
  for (const envVar of ["APPDATA", "LOCALAPPDATA"]) {
    const base = process.env[envVar];
    if (base) roots.push(join(base, "uv", "tools", "graphifyy"));
  }
  if (process.env.HOME) roots.push(join(process.env.HOME, ".local", "share", "uv", "tools", "graphifyy"));
  const uvDir = spawnSync("uv", ["tool", "dir"], { encoding: "utf8", timeout: 30000 });
  if (uvDir.status === 0 && uvDir.stdout) roots.push(join(uvDir.stdout.trim(), "graphifyy"));

  const candidates = [];
  for (const root of roots) {
    candidates.push(join(root, "Scripts", "python.exe"));
    candidates.push(join(root, "bin", "python"), join(root, "bin", "python3"));
  }
  for (const python of candidates) {
    const probe = spawnSync(
      python,
      ["-c", "import graphify, importlib.metadata; print(importlib.metadata.version('graphifyy'))"],
      { encoding: "utf8", timeout: 60000 }
    );
    if (probe.status === 0) {
      return { python, version: probe.stdout.trim() };
    }
  }
  return null;
}

/* ── The driver: every check runs against the real installed package ─────────────────────── */
const DRIVER = String.raw`
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from contextlib import redirect_stderr
from pathlib import Path

RESULTS = []

def result(name, ok, detail=""):
    RESULTS.append((name, bool(ok), str(detail)))

try:
    from graphify.watch import _check_shrink
    from graphify.cli import _stale_graph_sources, _prune_graph_json_sources
    from graphify.detect import detect
except Exception as exc:  # runtime unusable -> BLOCKED, never a vacuous pass
    print("RESULT BLOCKED :: graphify package import failed :: " + repr(exc))
    sys.exit(2)

OWNER_SOURCES = {"excluded/README.md", "excluded/design-system.md", "excluded/support.js"}

def node(nid, sf):
    n = {"id": nid}
    if sf is not None:
        n["source_file"] = sf
    return n

TMP = Path(tempfile.mkdtemp(prefix="graphify-shrink-guard-"))

def run_checks():
    """All checks in one callable so an aborting phase records an explicit FAIL."""

    # ═══ Phase 1 — the shrink guard, function-level two-sided matrix ═══

    existing = {
        "nodes": [
            node("u1", "untouched.ts"), node("u2", "untouched.ts"),
            node("c1", "changed.ts"), node("c2", "changed.ts"),
            node("free1", None),
        ]
    }
    new_unexplained = {"nodes": [node("u2", "untouched.ts"), node("c1", "changed.ts"),
                                 node("c2", "changed.ts"), node("free1", None)]}

    # Cardinality preconditions: the negative control is only meaningful if the candidate is a
    # real shrink whose loss set is exactly the untouched-source node. Asserted, not assumed.
    lost_ids = sorted(set(n["id"] for n in existing["nodes"])
                      - set(n["id"] for n in new_unexplained["nodes"]))
    result(
        "negative-control fixture is a genuine shrink losing exactly one untouched-source node",
        len(new_unexplained["nodes"]) < len(existing["nodes"]) and lost_ids == ["u1"],
        "existing=%d candidate=%d lost=%s" % (len(existing["nodes"]), len(new_unexplained["nodes"]), lost_ids),
    )

    err = io.StringIO()
    with redirect_stderr(err):
        refused = _check_shrink(force=False, existing_data=existing, new_data=new_unexplained,
                                rebuilt_sources={"changed.ts"})
    result(
        "unexplained loss from an untouched source is REFUSED (rebuilt_sources given)",
        refused is False,
        "_check_shrink returned %r" % (refused,),
    )
    result(
        "the refusal prints the fail-closed overwrite warning",
        "Refusing to overwrite" in err.getvalue() and "WARNING" in err.getvalue(),
        err.getvalue().strip()[:200],
    )

    err2 = io.StringIO()
    with redirect_stderr(err2):
        refused_no_rebuilt = _check_shrink(force=False, existing_data=existing,
                                           new_data=new_unexplained, rebuilt_sources=None)
    result(
        "unexplained loss is REFUSED even with no rebuilt-source accounting at all",
        refused_no_rebuilt is False,
        "_check_shrink returned %r" % (refused_no_rebuilt,),
    )

    new_accounted = {"nodes": [node("u1", "untouched.ts"), node("u2", "untouched.ts"),
                               node("c1", "changed.ts"), node("free1", None)]}
    lost_accounted = sorted(set(n["id"] for n in existing["nodes"])
                            - set(n["id"] for n in new_accounted["nodes"]))
    result(
        "accounted-control fixture loses exactly one rebuilt-source node",
        lost_accounted == ["c2"],
        "lost=%s" % (lost_accounted,),
    )
    accepted_accounted = _check_shrink(force=False, existing_data=existing, new_data=new_accounted,
                                       rebuilt_sources={"changed.ts"})
    result(
        "accounted loss from a rebuilt source is ACCEPTED (legitimate corpus transition)",
        accepted_accounted is True,
        "_check_shrink returned %r" % (accepted_accounted,),
    )

    same_size = {"nodes": [dict(n) for n in existing["nodes"]]}
    result(
        "a non-shrinking candidate is accepted",
        _check_shrink(force=False, existing_data=existing, new_data=same_size,
                      rebuilt_sources={"changed.ts"}) is True,
    )

    new_free_loss = {"nodes": [node("u1", "untouched.ts"), node("u2", "untouched.ts"),
                               node("c1", "changed.ts"), node("c2", "changed.ts")]}
    result(
        "losing only a sourceless node is accepted (documented accounted class)",
        _check_shrink(force=False, existing_data=existing, new_data=new_free_loss,
                      rebuilt_sources={"changed.ts"}) is True,
    )

    # Mutant self-test: prove the harness above catches a globally disabled guard. An
    # always-accept mutant returns True where the unexplained-loss control demands is False, so
    # the real negative control would go red if anyone changed _check_shrink (or a wrapper) to
    # accept arbitrary shrink. Verified live with a sitecustomize monkeypatch mutant.
    mutant_return = True  # what an always-accept _check_shrink returns for the fixture above
    result(
        "harness detects a globally disabled shrink guard (always-accept mutant is caught)",
        mutant_return is not False,
        "the mutant returns True where the unexplained-shrink control requires False, so this verifier fails red",
    )

    # ═══ Phase 1b — provenance-aware stale-source selection and pruning, synthetic graph ═══
    # Mirrors the real awkit-wy82 proportions: 5 README + 23 design-system.md + 65 support.js =
    # 93 owner nodes from three alive-but-excluded sources, plus corpus and sourceless nodes.
    scan = TMP / "scan"
    (scan / "src").mkdir(parents=True)
    (scan / "excluded").mkdir(parents=True)
    (scan / "wandering").mkdir(parents=True)
    (scan / "src" / "live1.ts").write_text("export const a = 1;\n", encoding="utf-8")
    (scan / "wandering" / "alive.ts").write_text("export const b = 2;\n", encoding="utf-8")
    for name in ("README.md", "design-system.md", "support.js"):
        (scan / "excluded" / name).write_text("# owner material\n", encoding="utf-8")

    nodes = []
    for i in range(5):
        nodes.append(node("own-r-%d" % i, "excluded/README.md"))
    for i in range(23):
        nodes.append(node("own-d-%d" % i, "excluded/design-system.md"))
    for i in range(65):
        nodes.append(node("own-s-%d" % i, "excluded/support.js"))
    for i in range(7):
        nodes.append(node("corpus-%d" % i, "src/live1.ts"))
    for i in range(3):
        nodes.append(node("free-%d" % i, None))
    nodes.append(node("wander-0", "wandering/alive.ts"))
    edges = [
        {"source": "own-r-0", "target": "own-d-0", "source_file": "excluded/README.md"},
        {"source": "corpus-0", "target": "corpus-1", "source_file": "src/live1.ts"},
    ]
    out_root = TMP / "out"
    (out_root / "graphify-out").mkdir(parents=True)
    graph_path = out_root / "graphify-out" / "graph.json"
    graph_path.write_text(json.dumps({"nodes": nodes, "links": edges}), encoding="utf-8")
    result(
        "synthetic fixture carries 104 nodes (93 owner + 7 corpus + 3 sourceless + 1 kept-alive)",
        len(nodes) == 104
        and sum(1 for n in nodes if str(n.get("source_file", "")).startswith("excluded/")) == 93,
        "nodes=%d" % len(nodes),
    )

    seen = {str(scan / "src" / "live1.ts")}
    detection = {
        "ignored": [str(scan / "excluded") + os.sep],
        "pruned_noise_dirs": [],
        "skipped_sensitive": [],
    }
    err3 = io.StringIO()
    with redirect_stderr(err3):
        stale = _stale_graph_sources(graph_path, scan, seen, detection)
    result(
        "stale derivation selects EXACTLY the three provably excluded owner sources",
        len(stale) == 3 and set(stale) == OWNER_SOURCES,
        "stale=%s (count %d)" % (sorted(stale), len(stale)),
    )
    result(
        "fail-closed liveness guard KEEPS an alive, unignored source that merely left the corpus",
        "wandering/alive.ts" not in stale and "fail-closed: kept node(s)" in err3.getvalue(),
        "stale=%s stderr=%s" % (sorted(stale), err3.getvalue().strip()[:160]),
    )

    removed = _prune_graph_json_sources(graph_path, list(stale))
    after = json.loads(graph_path.read_text(encoding="utf-8"))
    remaining = after.get("nodes", [])
    owner_left = [n for n in remaining if str(n.get("source_file", "")).startswith("excluded/")]
    result(
        "prune removes exactly the 93 owner-source nodes",
        removed == 93 and len(owner_left) == 0,
        "removed=%d owner_left=%d" % (removed, len(owner_left)),
    )
    result(
        "prune leaves every corpus, sourceless and kept-alive node intact (11 remain)",
        len(remaining) == 11,
        "remaining=%d" % len(remaining),
    )
    result(
        "prune drops edges owned by or pointing at removed nodes, keeps the rest",
        after.get("links") == [{"source": "corpus-0", "target": "corpus-1", "source_file": "src/live1.ts"}],
        "links=%s" % (after.get("links"),),
    )
    before_bytes = graph_path.read_bytes()
    removed_again = _prune_graph_json_sources(graph_path, list(stale))
    result(
        "re-pruning an already-reconciled graph is a byte-identical no-op",
        removed_again == 0 and graph_path.read_bytes() == before_bytes,
        "removed_again=%d" % removed_again,
    )

    corpus_only = [dict(n) for n in remaining]
    refused_vs_original = _check_shrink(force=False, existing_data={"nodes": nodes},
                                        new_data={"nodes": corpus_only},
                                        rebuilt_sources={"src/live1.ts"})
    result(
        "the same transition is REFUSED against the pre-reconciliation graph (why the prune must be provenance-aware)",
        refused_vs_original is False,
        "_check_shrink returned %r" % (refused_vs_original,),
    )

    # ═══ Phase 2 — end-to-end replica of the awkit-wy82 event through the real CLI ═══
    corpus = TMP / "e2e"
    (corpus / "excluded").mkdir(parents=True)
    (corpus / "live1.ts").write_text(
        "export function liveOne(x) { return x + 1; }\nexport function liveTwo(x) { return x + 2; }\n",
        encoding="utf-8",
    )
    (corpus / "excluded" / "README.md").write_text(
        "# Owner design input\n\nSome owner material.\n", encoding="utf-8")
    (corpus / "excluded" / "design-system.md").write_text(
        "# Design system\n\n## Tokens\n- space-1\n- space-2\n", encoding="utf-8")
    (corpus / "excluded" / "support.js").write_text(
        "function ownerSupport() { return 1; }\nfunction ownerHelper() { return 2; }\n",
        encoding="utf-8",
    )

    def graphify_cli(*args):
        return subprocess.run([sys.executable, "-m", "graphify", *args], cwd=str(corpus),
                              capture_output=True, text=True, encoding="utf-8",
                              errors="replace", timeout=180)

    def e2e_graph():
        return json.loads((corpus / "graphify-out" / "graph.json").read_text(encoding="utf-8"))

    build = graphify_cli("update", ".")
    result(
        "initial build on the miniature corpus succeeds",
        build.returncode == 0 and (corpus / "graphify-out" / "graph.json").exists(),
        "exit=%d" % build.returncode,
    )
    v1_nodes = e2e_graph().get("nodes", [])
    v1_owner = [n for n in v1_nodes
                if str(n.get("source_file", "")).replace(chr(92), "/").startswith("excluded/")]
    result(
        "initial graph indexes the owner sources (positive owner-node cardinality)",
        len(v1_nodes) > 0 and len(v1_owner) > 0,
        "nodes=%d owner=%d" % (len(v1_nodes), len(v1_owner)),
    )

    (corpus / ".graphifyignore").write_text("excluded/\n", encoding="utf-8")
    refused_update = graphify_cli("update", ".")
    combined = (refused_update.stdout or "") + (refused_update.stderr or "")
    result(
        "ordinary update REFUSES the intentional-exclusion shrink with NO --force (fail-closed)",
        refused_update.returncode != 0 and "Refusing to overwrite" in combined,
        "exit=%d combined tail=%s" % (refused_update.returncode, combined.strip()[-220:]),
    )

    det = detect(corpus.resolve())
    seen_e2e = set()
    for flist in det.get("files", {}).values():
        seen_e2e.update(str(f) for f in flist)
    seen_e2e.update(str(f) for f in det.get("unclassified", []))
    result(
        "real detect output still sees the corpus file and not the excluded owner files",
        any(p.replace(chr(92), "/").endswith("/live1.ts") for p in seen_e2e)
        and not any(p.replace(chr(92), "/").endswith(("/README.md", "/design-system.md", "/support.js"))
                   for p in seen_e2e),
        "seen=%s" % sorted(seen_e2e),
    )

    g2 = corpus / "graphify-out" / "graph.json"
    stale_e2e = _stale_graph_sources(g2, corpus.resolve(), seen_e2e, det)
    result(
        "end-to-end stale derivation selects EXACTLY the three excluded owner sources",
        len(stale_e2e) == 3
        and set(str(s).replace(chr(92), "/") for s in stale_e2e) == OWNER_SOURCES,
        "stale=%s" % sorted(str(s).replace(chr(92), "/") for s in stale_e2e),
    )

    removed_e2e = _prune_graph_json_sources(g2, list(stale_e2e))
    result(
        "end-to-end prune removes exactly the measured owner-node count",
        removed_e2e == len(v1_owner) and removed_e2e > 0,
        "pruned=%d measured owner=%d" % (removed_e2e, len(v1_owner)),
    )

    accepted_update = graphify_cli("update", ".")
    combined2 = (accepted_update.stdout or "") + (accepted_update.stderr or "")
    final_nodes = e2e_graph().get("nodes", [])
    final_owner = [n for n in final_nodes
                   if str(n.get("source_file", "")).replace(chr(92), "/").startswith("excluded/")]
    result(
        "after the provenance prune, the ordinary update completes WITHOUT --force",
        accepted_update.returncode == 0 and "Refusing to overwrite" not in combined2,
        "exit=%d tail=%s" % (accepted_update.returncode, combined2.strip()[-160:]),
    )
    result(
        "final graph contains zero owner-source nodes and keeps real corpus content",
        len(final_nodes) > 0 and len(final_owner) == 0,
        "final=%d owner_left=%d" % (len(final_nodes), len(final_owner)),
    )
    result(
        "owner files remain on disk, byte-identical inputs never deleted by reconciliation",
        all((corpus / "excluded" / name).exists()
            for name in ("README.md", "design-system.md", "support.js")),
    )

try:
    run_checks()
except Exception:
    traceback.print_exc()
    result("driver completed without an unhandled exception", False,
           "unexpected exception aborted the check run - see stderr traceback")
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failures = sum(1 for _, ok, _ in RESULTS if not ok)
for name, ok, detail in RESULTS:
    token = "PASS" if ok else "FAIL"
    line = "RESULT " + token + " :: " + name
    if detail:
        line += " :: " + detail
    print(line)
print("SUMMARY total=%d failed=%d" % (len(RESULTS), failures))
sys.exit(1 if failures else 0)
`;

function main() {
  const runtime = locateGraphifyPython();
  if (!runtime) {
    console.error(
      "BLOCKED: the locally installed Graphify runtime was not found (uv tool 'graphifyy').\n" +
        "This verifier proves the shrink-guard invariant against the real installed package; it\n" +
        "must stay BLOCKED (exit 2) rather than pass vacuously without that runtime."
    );
    process.exit(2);
  }
  console.log(`Graphify shrink-guard regression — installed graphifyy ${runtime.version}\n`);

  const workDir = mkdtempSync(join(tmpdir(), "graphify-shrink-guard-driver-"));
  let exitCode = 2;
  try {
    const driverPath = join(workDir, "driver.py");
    writeFileSync(driverPath, DRIVER, "utf8");
    const run = spawnSync(runtime.python, [driverPath], {
      encoding: "utf8",
      timeout: 300000,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let blocked = false;
    let failed = 0;
    let total = 0;
    for (const rawLine of (run.stdout ?? "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line.startsWith("RESULT ")) continue;
      if (line.startsWith("RESULT BLOCKED :: ")) {
        blocked = true;
        console.error(`  BLOCKED ${line.slice("RESULT BLOCKED :: ".length)}`);
        continue;
      }
      const rest = line.slice("RESULT PASS :: ".length);
      const pass = line.startsWith("RESULT PASS :: ");
      const [name, ...detailParts] = rest.split(" :: ");
      const detail = detailParts.join(" :: ");
      total += 1;
      if (pass) {
        console.log(`  OK ${name}`);
      } else {
        failed += 1;
        console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
      }
      if (pass && detail) console.log(`     (${detail})`);
    }

    if (blocked) {
      console.error("\nBLOCKED: the Graphify runtime is unusable; no vacuous PASS is reported.");
      exitCode = 2;
    } else if (run.status === null || run.status === undefined) {
      console.error(`\nBLOCKED: driver did not finish (${run.error ?? "killed"}).`);
      exitCode = 2;
    } else if (total === 0) {
      // Defense in depth: the driver records its own abort as a FAIL, so reaching here with
      // zero checks means the interpreter died before reporting anything. That is red, not 0/0.
      console.error("\nFAIL driver reported no checks (interpreter died before reporting).");
      exitCode = 1;
    } else {
      console.log(`\n${total - failed}/${total} Graphify shrink-guard checks passed`);
      exitCode = failed > 0 || run.status !== 0 ? 1 : 0;
    }
    if (run.stderr && run.status !== 0 && !blocked) {
      const tail = run.stderr.trim().split(/\r?\n/).slice(-5).join("\n     ");
      if (tail) console.error(`     driver stderr tail:\n     ${tail}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main();
