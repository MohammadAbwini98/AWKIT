# L11 — Performance-oriented DOM intelligence

Beads `awkit-djnl.19` (parent `awkit-djnl`). Registered 2026-09-30 on a new owner decision (contract
`awkit-l11-registration-0930`). Blocks edges on closed L3 (`.4`), L5a (`.7`), L7 (`.10`) and L10
(`.18`).

## Relationship to L10

L10 stays **closed as NO-GO** with its evidence unchanged
(`evidence/L10.0-dom-intelligence-gate-2026-09-30.md`). L11 is a different objective, not a reopening of
L10 under a relaxed DI5:

- L10 asked whether Scrapling finds targets AWKIT cannot. Under the unchanged gates it does not.
- L11 asks whether the **expensive candidate-discovery portion** of recovery can be replaced by one
  bounded DOM snapshot, and whether parser-only Scrapling is useful as **candidate evidence** once
  AWKIT's own proof stays authoritative. DI5 is unchanged: no new threshold, no trust in a provider score.

## Objective and target

- Fast locator healing after a saved locator fails, with minimal Playwright ↔ Node round trips.
- **Target, to prove, not assumed:** warm locator-healing p95 under 500 ms on the protected fixtures,
  zero wrong-element execution, no regression of a currently correct recovery.
- A normal successful step pays no new cost.

## Design decisions

### E1 — The cost is round trips, so the fix is one snapshot

Legacy local recovery scores up to 200 elements with one `nth(i).evaluate` round trip each (and
`nth` on `*:visible` re-queries the page); the blueprint layer spends three round trips per element.
L11 replaces both loops with one `evaluateAll` per layer. `evaluateAll` receives Playwright's own
`*:visible` (or `body *`) match list, in the order `nth(i)` resolves, so an index is exact.

### E2 — Exact pruning, so the scan cap can grow

`similarity()` weighs tag 0.12, role 0.18, name 0.32, text 0.18, attributes 0.10, ancestry 0.10.
An element that matches neither the recorded tag nor the recorded (non-empty) role scores at most
0.70. A winner needs 0.86 and a runner-up only matters above 0.86 − 0.08 = 0.78, so pruning to
`tag == recorded.tag OR role == recorded.role` in the page changes no decision. The pruned set is
scored in full (cap 5,000 pruned elements; over the cap the snapshot path refuses).

### E3 — AWKIT proof is the only automatic authority

The snapshot layer applies the **unchanged** rules: 0.86 threshold, 0.08 margin over every pruned
visible element, `RECOVERY_MIN_ANCESTRY` 0.5 veto, step-type compatibility, sensitive steps never
recover, guarded-positional and closed-shadow keep their own paths. Before a recovered locator is
returned, the element at that index is re-fingerprinted and must equal the snapshot fingerprint
(stale-snapshot guard).

Consequence, stated because it decides Scrapling's role: when the margin is computed over every
pruned visible element, **any** externally proposed candidate passes the proof only if it is
already AWKIT's own best match with margin. A provider therefore cannot add an automatic recovery
under DI5; it can only agree or be refused. The benchmark measures this rather than assuming it.

### E4 — Provider role: evidence and suggestions, never execution

- Capability-named `DomIntelligenceProvider` (`getStatus`, `saveReference`,
  `findRecoveryCandidates`, `normalizeForAi`, `shutdown`), with `NoopDomIntelligenceProvider` and
  `ScraplingDomIntelligenceProvider`. Core modules never import Scrapling concepts.
- Runner: consulted only after the snapshot proof failed, only when a stored reference exists, with
  a hard budget. Its candidates are re-scored by AWKIT and recorded as a bounded, non-executing repair
  suggestion in run provenance.
- Element Spy and the Designer: on-demand diagnosis on the Spy's live page. Every candidate carries
  AWKIT's score, the provider score and a proof state. Applying one is an explicit user edit; nothing
  is rewritten silently.

### E5 — Parser-only host

- Embedded CPython 3.12.10 (python.org embeddable zip, SHA-256 pinned from python.org's SBOM),
  a main-owned child process, JSON lines over stdio.
- Finite versioned operations: `hello`, `health`, `save_reference`, `find_candidates`,
  `normalize_dom`, `shutdown`. Unknown operations and properties are rejected. Bounded request and
  response sizes. Exits on stdin EOF (no orphan).
- A Python audit hook installed before any third-party import refuses sockets, subprocesses,
  `os.system`/`exec`/`spawn`/`startfile`, `ctypes`, SQLite connections, file writes, deletes and
  renames, and imports of fetcher, spider, engine, AI, shell, Playwright, Patchright, curl_cffi or MCP
  modules.
- The shipped tree drops Scrapling's `fetchers/`, `spiders/`, `engines/`, `core/ai.py`,
  `core/shell.py`, `cli.py` and `integrations/`, the `tld` package (only the unused SQLite store
  imports it), and the runtime's network, TLS, FFI and async extension modules.

### E6 — HTML leaves the page only after in-page sanitization

A custom serializer runs in the resolved frame: no `script`, `style`, `template`, `noscript`,
comments or SVG bodies; no `value`, `on*`, `style` or `srcdoc` attributes; URLs reduced to their
path; password, one-time-code and hidden inputs dropped entirely; bounded bytes. A document holding a
protected-login field is refused outright. Visible elements carry `data-awkit-v=<index>` in the
serialized copy only; the live DOM is never touched. Shadow roots are not serialized.

### E7 — AWKIT-owned references

Scrapling's default adaptive SQLite store is never used. The Recorder captures a minimized reference
in the page (tag, role, allowlisted attributes, filtered class tokens, bounded text, tag-only
ancestry, siblings and children, the parent's tag and allowlisted attributes). Main redacts it with the
existing `SecretMasker`/`SemanticRedactor` and stores it in a sidecar store under
`%LOCALAPPDATA%/SpecterStudio/dom-references`, keyed by the step's `blueprintId` and bound to its
candidate digest, so any locator edit invalidates it. Never for sensitive steps, shadow targets or
protected-login documents. Refresh only after the recorded locator itself resolved uniquely, never
from a recovery.

### E8 — Context binding

The snapshot runs on the root the existing frame-chain and container resolution produced; the
blueprint layer keeps its page and frame keys; the provider sees only that frame's sanitized DOM.
A candidate from another page, popup, route or frame cannot satisfy a step.

### E9 — What a snapshot cannot see

An element that is not mounted (virtualized row, lazy panel, delayed render) is not in the snapshot.
L11 adds no scrolling or sleeping: the existing grace retry and waits stay the only mechanisms, and an
unmounted target leaves the step unresolved (fail closed).

### E10 — AI-context normalization

In-page minimization also drops computed-hidden elements before the HTML leaves the page. The
provider returns a typed, bounded structure (landmarks, interactive elements, alerts, forms, tables,
truncation); the existing `SemanticRedactor` runs on every string. It is compared with the browser's
own text on facts retained, leaks and size before any AI feature consumes it.

## Final recovery order

```text
guarded positional ─► closed-shadow bridge ─► primary + alternatives (remembered winner first)
   └─ all miss ─► grace retry ─► snapshot proof (local, one evaluateAll)
                    └─ refused ─► snapshot proof (blueprint window, one evaluateAll)
                                   └─ refused ─► provider suggestion (non-executing) ─► existing failure
```

## Workstreams

| Id | Scope |
|---|---|
| L11.A | Baseline, architecture freeze, registration |
| L11.B | Provider contract, no-op provider, parser-only host, lifecycle, security tests |
| L11.C | Reference lifecycle: Recorder seeding, redaction, storage, invalidation, refresh |
| L11.D | Snapshot recovery in the runner, provider suggestions, old-vs-new benchmark |
| L11.E | Element Spy and Designer on-demand diagnosis with explicit apply |
| L11.F | Frames, popups, routes, virtualized and delayed-render fixtures |
| L11.G | AI-context normalization and its comparison |
| L11.H | Status, provenance and privacy-safe reporting |
| L11.I | Packaging, offline validation, closeout |

## Status (2026-10-01)

| Id | State | Evidence |
|---|---|---|
| L11.A–E | Done | `6621e56f` … `56d6b140`, the Designer/Spy/Settings stage (see `docs/ai/CURRENT_STATE.md`) |
| L11.F | Done | `1247f122`: route binding, actionability veto, `/dom-context-lab`; `verify:dom-intelligence-contexts` 48/0, 8 of 8 mutations killed |
| L11.G | Done, **off by default** | `29701c5a`: `verify:dom-normalization` 143/0, 5 of 5 mutations; the live comparison regressed one row, so it runs only with `AWKIT_AI_PAGE_CONTEXT=on` (`evidence/L11-normalization-2026-10-01.md`) |
| L11.H | Done, one event not recorded | `4dd3912e`: `verify:recovery-provenance` 31/0, 4 of 4 mutations. "Suggestion accepted by user" is not an execution event and is not recorded |
| L11.I benchmark | Done | `3af2cd68`: `verify:dom-intelligence-acceptance` 10/0, 0 wrong-element actions on the product path, warm p95 170 ms on the accepted fixtures, not universal at 8k elements; 3 of 3 mutations (`evidence/L11-acceptance-2026-10-01.md`) |
| L11.I packaging | Done | `84771a12`, `bea84fda`: extraResources, staging, signed-manifest section and strict validation (165/165 files, 2 of 2 mutations). After the owner committed the L5a evidence (`1d19ae26`), `package:portable` passed at `1a996a82` with strict validation inside it, and the clean signed manifest is `a18c2401`. `verify:dom-intelligence-packaged` 20/0 on `dist/win-unpacked`: the signed tree, Available in IPC and Settings, the host as main's child, no orphan. Authenticode unsigned |
| Independent review | Done, partial (Sonnet QC; CodeCraft BLOCKED) | No high-severity finding. 6 of 8 fixed with 7 mutations killed. The other two were fixed after the review: the lazy-index window by pinning the proven node (`5a312548`), and the page context is now gated before capture (`dcae3ba0`, off by default). See `evidence/L11-acceptance-2026-10-01.md` |
| Licensing | **Owner decision pending** | orjson MPL-2.0 obligations met in the notices. lxml's Windows wheel statically links LGPL-2.1 libiconv. How its relinking obligation is met for an external release is undecided |

## Acceptance

The milestone closes only with evidence that: normal steps are unchanged; failed locators recover
through the snapshot path with measured old and new latency; the protected fixtures show zero
wrong-element actions and no lost recovery; references are minimized, redacted, bound and invalidated;
Spy and Designer never rewrite a locator silently; protected-login surfaces stay excluded; the host is
offline, finite and ships no forbidden extra; provider absence, corruption or timeout falls back;
existing workflows run unchanged; every new enforcement layer has mutation evidence; packaged evidence
is truthful; and the roadmap sources agree.
