/**
 * Join the three ID namespaces that the repository keeps apart.
 *
 *   case IDs    REC-0xx / SYS-REP-0xx / SET-0xx      (what was tested)
 *   defect IDs  AWKIT-<AREA>-00x / HARNESS-00x       (what was found)
 *   bead IDs    awkit-<hash>                          (what is tracked)
 *
 * Nothing in the repository enforces or validates these links — they exist only inside free-text
 * fields. So every link this module produces carries a confidence and a basis, and the UI renders
 * the three tiers differently:
 *
 *   declared  a real field pointing at a real record        -> solid, navigable
 *   inferred  an ID found in prose                          -> dashed, "mentioned in text"
 *   dangling  an ID cited that does not exist here          -> grey, inert, labelled
 *
 * The dangling tier is not an edge case to tidy away. DEFECTS.md cites CMP-CON-002, which is not
 * among the ledger's 66 cases. Dropping such tokens would silently hide the fact that the defect
 * register references a case package the dashboard cannot see.
 */

/** Case IDs as written: REC-001, SYS-REP-016, SET-021. */
const CASE_ID = /\b((?:REC|SYS-REP|SET)-\d{3})\b/g;
/** Defect IDs as written: AWKIT-REC-001, AWKIT-ORA-E2E-002, HARNESS-004. */
const DEFECT_ID = /\b((?:AWKIT-[A-Z0-9]+(?:-[A-Z0-9]+)*|HARNESS)-\d{3})\b/g;
/** Bead IDs as written in prose: bd `awkit-64x` or a bare awkit-wza.4 */
const BEAD_ID = /\b(awkit-[a-z0-9]+(?:\.\d+)?)\b/g;

/**
 * @typedef {Object} Link
 * @property {string} from
 * @property {string|null} to
 * @property {string} [unresolvedText]
 * @property {string} relation
 * @property {string} basis
 * @property {"declared"|"inferred"|"dangling"} confidence
 */

/**
 * @param {import("./normalize.mjs").WorkItem[]} items
 * @param {import("./parse-defects.mjs").Defect[]} defects
 * @param {import("./parse-known-issues.mjs").KnownIssueEntry[]} knownIssues
 * @returns {{links: Link[], unresolved: {token: string, citedBy: string[]}[], stats: Record<string, number>}}
 */
export function buildLinks(items, defects, knownIssues) {
  const known = new Set(items.map((i) => i.id));

  /** @type {Link[]} */
  const links = [];
  /** @type {Map<string, Set<string>>} */
  const unresolved = new Map();

  /**
   * @param {string} token
   * @param {string} from
   */
  const noteUnresolved = (token, from) => {
    const set = unresolved.get(token) ?? new Set();
    set.add(from);
    unresolved.set(token, set);
  };

  // 1. detected-by — the one declared cross-namespace field in the repository.
  //
  // The field usually cites a ledger case, but not always: HARNESS-008 was detected by the defect
  // AWKIT-E2E-001, not by a case. So both namespaces are tried before a token is called dangling.
  for (const d of defects) {
    const from = `defect:${d.id}`;
    for (const token of d.detectedBy) {
      const target = [`case:${token}`, `defect:${token}`].find((candidate) => known.has(candidate));
      if (target) {
        links.push({
          from,
          to: target,
          relation: "detected-by",
          basis: "DEFECTS.md 'Detected by' field",
          confidence: "declared"
        });
      } else {
        links.push({
          from,
          to: null,
          unresolvedText: token,
          relation: "detected-by",
          basis: "DEFECTS.md 'Detected by' field — no such case in this ledger",
          confidence: "dangling"
        });
        noteUnresolved(token, from);
      }
    }
  }

  // 2. mentions — IDs found in prose. Inference, and rendered as such. A bead description saying
  //    "Found while executing REC-028 (AWKIT-REC-001)" is a real signal, but it is not a field.
  for (const item of items) {
    if (item.kind !== "issue") continue;
    const haystack = `${item.title} ${item.body}`;

    for (const [pattern, prefix, relation] of [
      [CASE_ID, "case:", "mentions-case"],
      [DEFECT_ID, "defect:", "mentions-defect"]
    ]) {
      /** @type {Set<string>} */
      const seen = new Set();
      for (const m of haystack.matchAll(pattern)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        const target = `${prefix}${m[1]}`;
        if (known.has(target)) {
          links.push({
            from: item.id,
            to: target,
            relation,
            basis: "ID found in the issue's own text",
            confidence: "inferred"
          });
        } else {
          links.push({
            from: item.id,
            to: null,
            unresolvedText: m[1],
            relation,
            basis: "ID found in the issue's own text — no such record here",
            confidence: "dangling"
          });
          noteUnresolved(m[1], item.id);
        }
      }
    }
  }

  // 3. bead references inside KNOWN_ISSUES.md prose.
  for (const entry of knownIssues) {
    for (const ref of entry.beadRefs) {
      const target = `bead:${ref}`;
      const from = `knownIssue:${entry.line}`;
      if (known.has(target)) {
        links.push({
          from,
          to: target,
          relation: "known-issue-ref",
          basis: "KNOWN_ISSUES.md bead reference",
          confidence: "declared"
        });
      } else {
        links.push({
          from,
          to: null,
          unresolvedText: ref,
          relation: "known-issue-ref",
          basis: "KNOWN_ISSUES.md bead reference — not in the beads export",
          confidence: "dangling"
        });
        noteUnresolved(ref, from);
      }
    }
  }

  const unresolvedList = [...unresolved.entries()]
    .map(([token, citedBy]) => ({ token, citedBy: [...citedBy].sort() }))
    .sort((a, b) => a.token.localeCompare(b.token));

  return {
    links,
    unresolved: unresolvedList,
    stats: {
      total: links.length,
      declared: links.filter((l) => l.confidence === "declared").length,
      inferred: links.filter((l) => l.confidence === "inferred").length,
      dangling: links.filter((l) => l.confidence === "dangling").length,
      unresolvedTokens: unresolvedList.length
    }
  };
}

/**
 * Detect where a bead's prose asserts a ledger count that disagrees with the measured ledger.
 *
 * This is a real, currently-live condition: awkit-8ri says "Settings full-page coverage: 4 NOT RUN"
 * and awkit-az7 says "7 NOT RUN" for Reports, while the ledger measures 2 and 2. Both numbers are
 * shown with their sources. They are never reconciled or averaged — which of the two is correct is
 * a judgement about the world, not something a parser can settle.
 *
 * @param {import("./normalize.mjs").WorkItem[]} items
 * @param {import("./parse-ledger.mjs").LedgerCase[]} cases
 * @returns {{itemId: string, claimed: number, measured: number, area: string, text: string}[]}
 */
export function findStaleClaims(items, cases) {
  /** @type {{itemId: string, claimed: number, measured: number, area: string, text: string}[]} */
  const out = [];

  const families = [
    { needle: "settings", prefix: "SET" },
    { needle: "reports", prefix: "SYS-REP" },
    { needle: "recorder", prefix: "REC" }
  ];

  for (const item of items) {
    if (item.kind !== "issue" || item.status !== "open") continue;
    const text = `${item.title} ${item.body}`;

    const m = /(\d+)\s+NOT RUN/i.exec(text);
    if (!m) continue;

    const family = families.find((f) => text.toLowerCase().includes(f.needle));
    if (!family) continue;

    const measured = cases.filter(
      (c) => c.id.startsWith(`${family.prefix}-`) && c.status === "NOT RUN"
    ).length;
    const claimed = Number(m[1]);
    if (claimed === measured) continue;

    out.push({
      itemId: item.id,
      claimed,
      measured,
      area: family.prefix,
      text: m[0]
    });
  }

  return out;
}
