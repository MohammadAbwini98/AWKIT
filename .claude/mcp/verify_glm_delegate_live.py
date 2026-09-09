#!/usr/bin/env python3
"""
LIVE verifier for the glm-delegate MCP server. This one really calls Z.AI.

WHAT THIS PROVES
    That the raised repository read budget and the separated response budget work end to end
    against the real provider, over the same stdio MCP path Claude Code uses: a repository slice
    larger than the old 240,000-byte total is assembled, sent to GLM-5.3, and answered with a
    bounded report inside a requested 16384-token budget.

    It runs four real calls and records, verbatim, what the provider reported: input tokens,
    cached input tokens, output tokens and stop reason. Nothing here is estimated from byte counts.

        1. A tiny response-shape probe (see below).
        2. glm_delegate on the widest scope at the contract's 16384-token response budget.
        3. glm_delegate on a NARROWED packet at the same 16384 budget, so the two runs differ in
           exactly one variable: how much repository source was sent.
        4. glm_review on the narrowed scope at its shipped default budget, as the regression case.

    Why the A/B exists, and why it varies the packet rather than the budget: GLM-5.3 answers with
    `thinking` blocks that are charged to max_tokens and deliberately never rendered, so on a wide
    packet the reasoning can consume the whole response budget before the report is written. A
    measured run over 432,572 bytes at 16384 spent 63,378 characters on reasoning and stopped on
    max_tokens. Raising max_tokens instead was tried first and was the wrong experiment: 32768 over
    the same packet exceeded the server timeout and returned no report at all, measuring latency
    rather than any budget. Both packets clear the old 240,000-byte ceiling, so either proves the
    raised input budget alone.

    Step 3 was built to test the obvious remedy - a smaller packet leaves more budget for the
    report - and REFUTED it: the narrowed 287,972-byte packet returned 1,576 characters against the
    wide packet's 29,414, spending MORE of the budget on reasoning (75,697 characters against
    43,692), and both stopped on max_tokens. The server's text has since been corrected to stop
    recommending it. The leg is kept because the refutation is the evidence.

A PROBE, NOT AN INFERENCE
    Before anything expensive, one ~50-token call dumps the provider's actual response shape -
    block types, per-block sizes, usage keys. Both facts above (unrendered reasoning; prompt-cache
    accounting that moves input OUT of input_tokens) were found that way rather than deduced from
    token arithmetic, and the DIAG checks go red if either stops being true.

REQUIRES THE PUBLIC INTERNET AND A CREDENTIAL
    GLM_API_KEY must be set. Without it this verifier reports BLOCKED and spends nothing. It is a
    live-network verifier in the same class as verify:wdu-live and is NOT part of AWKIT's offline
    guarantee: the delegation server is developer tooling and is never packaged.

IT NEVER WRITES TO THE REPOSITORY
    Before each delegation it fingerprints every file in the scope (size + SHA-256) and re-checks
    them afterwards, so "the delegate performed no repository modification" is measured, not
    assumed.

RUN, AND WHY IT RESUMES
    npm run verify:glm-delegate-live

    Run it repeatedly. Each invocation executes exactly ONE leg and then stops, recording its
    result in a state file under the system temp directory; the invocation that finishes the last
    leg replays the whole transcript and prints the single aggregate verdict.

    That shape is forced by the environment this runs in, not chosen for elegance. A leg here can
    take many minutes - one measured review exceeded 1500 seconds - while the agent shell that
    drives it must run in the foreground and is capped well below that. Splitting by leg keeps
    every call inside the cap, so a slow provider produces the server's own timeout diagnostic
    instead of a killed process and no evidence at all. Nothing is selected by a flag or an
    environment variable: the next pending leg is chosen in code, because the write-lease grammar
    that permits this script to run at all admits no arguments.

    The state resets itself when the server or either verifier changes on disk, when the last leg
    completes, or after 12 hours - so a partial run can never be finished against a different
    build and reported as one result.

EXIT CODES
    0 all legs ran and every check passed.  1 a check failed.  2 legs remain - no verdict yet.
    3 BLOCKED, nothing was spent (no credential).
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
# Live runs take minutes and are usually watched through a redirected log rather than a terminal,
# where Python would otherwise block-buffer and show nothing at all until the process exits.
try:
    sys.stdout.reconfigure(line_buffering=True)
except (AttributeError, ValueError):
    pass

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
OLD_TOTAL_READ_BUDGET = 240_000
REQUESTED_MAX_TOKENS = 16384

# Three nested deadlines, innermost first, so that whatever gives way first produces a diagnostic
# rather than a corpse. The SERVER timeout is what the delegation server itself enforces and is the
# only one that yields the useful message ("nothing was written here - no repository state
# changed"). The CLIENT timeout is this script waiting on that server, and sits above it so the
# server always speaks first. Both sit under the ~600s ceiling of the foreground shell that invokes
# one leg per call, which is why a leg is a whole invocation: see RUN, AND WHY IT RESUMES.
#
# These are deadlines, not predictions. Measured latency on this endpoint does not track packet
# size - a 432,572-byte review completed twice while a 287,972-byte one exceeded 1500s - so a
# timeout here is a fact about that call, never a verdict on the budget being tested.
SERVER_TIMEOUT_SECONDS = 540
CLIENT_TIMEOUT_SECONDS = 565

# One leg per invocation; the state lives outside the repository because this verifier holds no
# write lease over anything in it.
STATE_PATH = Path(tempfile.gettempdir()) / "awkit-verify-glm-delegate-live-state.json"
STATE_MAX_AGE_SECONDS = 12 * 3600
STAGES = ("probe", "wide", "narrow", "review")

# A leg that ends in the SERVER's own timeout diagnostic is re-attempted on the next invocation,
# up to this many tries, and only for that one cause. The reason is the measurement above: latency
# on this endpoint does not track packet size, and the wide packet that timed out at 510s here had
# completed twice in an earlier run at a longer deadline. Banking the first timeout as the verdict
# would report variance as a defect in the budget under test. Every attempt's transcript is kept
# and replayed, so a leg that needed three tries says so; a leg that exhausts them is a FAIL.
MAX_LEG_ATTEMPTS = 3
PROVIDER_TIMEOUT_MARKER = "GLM call exceeded the"

# Candidate delegation scopes, narrowest first. The run picks the first one that clears the old
# read budget with margin: the point is to prove the raised budget carries a real subsystem, not to
# spend the widest possible packet. A narrower scope that still exceeds 240,000 bytes proves exactly
# the same thing for less money.
CANDIDATE_SCOPES = [
    ["app/main/ipc"],
    ["app/main/ipc", "app/main/execution"],
    ["app/main"],
]
SCOPE_MARGIN_BYTES = 250_000

# The offline harness owns the MCP stdio client and the PASS/FAIL bookkeeping; reusing it keeps one
# implementation of "spawn the server the way .mcp.json does" rather than two that can drift.
_spec = importlib.util.spec_from_file_location(
    "verify_glm_delegate_offline", HERE / "verify_glm_delegate.py")
harness = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(harness)

check = harness.check
section = harness.section

OBJECTIVE = (
    "Perform a bounded architectural analysis of the selected AWKIT subsystem. Identify "
    "responsibility boundaries, key call paths, concurrency or lifecycle risks, and potential "
    "regression areas. Cite specific files and distinguish verified source observations from "
    "inference. Do not propose unrelated changes."
)

_BLOCKED = []


def blocked(reason):
    _BLOCKED.append(reason)
    print("  BLOCKED  " + reason)


# ------------------------------------------------------------------------------ local accounting

def survey(glm, scope):
    """What this scope resolves to locally, before anything is sent.

    Returns (matched, sent, bytes). `matched` is what the scope expanded to; `sent` is what would
    actually reach the prompt after the per-file, total-byte and file-count budgets are applied.
    Measuring this first costs nothing and lets the verifier refuse to spend an API call on a scope
    that could not prove what it is meant to prove.
    """
    budget = glm.resolve_read_budget()
    root = glm.repo_root()
    matched, _ = glm._expand_scope(root, scope, budget)
    _, sent, notes, total = glm.read_scope_text(root, scope, budget)
    return [p.relative_to(root).as_posix() for p in matched], sent, notes, total


def fingerprint(paths):
    """Size and SHA-256 for every file in the scope, so any repository write would be visible."""
    prints = {}
    for relative in paths:
        path = REPO_ROOT / relative
        try:
            data = path.read_bytes()
        except OSError as error:
            prints[relative] = "unreadable: {0}".format(error)
            continue
        prints[relative] = "{0}:{1}".format(len(data), hashlib.sha256(data).hexdigest())
    return prints


# ------------------------------------------------------------------------------- response parsing

def field(text, label, cast=str):
    """One `Label: value` line from the server's own header or footer."""
    prefix = label + ":"
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            raw = stripped[len(prefix):].strip().rstrip(".")
            try:
                return cast(raw)
            except (TypeError, ValueError):
                return None
    return None


def leading_int(text, label):
    """`Label: 16384 tokens (…)` -> 16384."""
    raw = field(text, label)
    if raw is None:
        return None
    head = raw.split()[0] if raw.split() else ""
    try:
        return int(head)
    except ValueError:
        return None


def call_tool(client, request_id, name, arguments):
    reply = client.request(request_id, "tools/call",
                           {"name": name, "arguments": arguments},
                           timeout=CLIENT_TIMEOUT_SECONDS)
    result = reply.get("result") or {}
    text = "".join(block.get("text", "") for block in result.get("content", []))
    return result, text


def report_metrics(title, text, matched, sent, surveyed_bytes):
    """The evidence block. Every number is either measured here or quoted from the provider."""
    print("\n  {0}".format(title))
    print("    Files matched (local):            {0}".format(len(matched)))
    print("    Files actually sent (local):      {0}".format(len(sent)))
    print("    Source bytes sent (local survey): {0}".format(surveyed_bytes))
    print("    Files sent (server header):       {0}".format(field(text, "Files sent", int)))
    print("    Source bytes sent (server):       {0}".format(field(text, "Source bytes sent", int)))
    print("    Requested output budget:          {0}".format(
        leading_int(text, "Requested output budget")))
    print("    Effective output budget:          {0}".format(
        leading_int(text, "Effective output budget")))
    print("    GLM input_tokens:                 {0}".format(
        field(text, "Input tokens reported by provider", int)))
    print("    GLM cache_read_input_tokens:      {0}".format(
        field(text, "Cached input tokens read (provider)", int)))
    print("    GLM cache_creation_input_tokens:  {0}".format(
        field(text, "Cached input tokens written (provider)", int)))
    print("    GLM output_tokens:                {0}".format(
        field(text, "Output tokens reported by provider", int)))
    print("    Stop reason:                      {0}".format(field(text, "Stop reason")))
    discarded = field(text, "Non-rendered response blocks")
    print("    Non-rendered blocks:              {0}".format(
        discarded.split(". ")[0] if discarded else "(none reported)"))
    print("    Response characters:              {0}".format(len(text)))


# ------------------------------------------------------------------- response-shape diagnostic

def probe_response_shape(glm):
    """One deliberately tiny call, to see what the provider actually puts in `content`.

    The first live run spent its whole 16384-token budget and returned far less text than that many
    tokens could hold, which is the signature of billed content the server never renders: call_glm
    keeps only blocks whose type is "text" and drops the rest silently. Rather than infer that from
    the arithmetic, this asks the endpoint directly with a trivial prompt and a 512-token budget,
    and reports the block types and usage keys verbatim.

    It costs a rounding error next to the delegations below, and it is the difference between
    "the report looked truncated" and knowing why.
    """
    section("DIAGNOSTIC - what the provider actually returns in `content`")

    key = glm._configured_key()
    base = glm._setting("GLM_BASE_URL", glm.DEFAULT_BASE_URL).rstrip("/")
    model = glm._setting("GLM_MODEL", glm.DEFAULT_MODEL)

    payload = json.dumps({
        "model": model,
        "max_tokens": 512,
        "system": "You are a diagnostic probe. Answer in one short sentence.",
        "messages": [{"role": "user", "content": "Name the capital of France."}],
    }).encode("utf-8")

    request = urllib.request.Request(
        base + "/v1/messages", data=payload, method="POST",
        headers={"content-type": "application/json", "accept": "application/json",
                 "anthropic-version": "2023-06-01", "x-api-key": key,
                 "authorization": "Bearer " + key, "user-agent": "verify-glm-delegate-live/1.0"})

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except Exception as error:  # noqa: BLE001 - a diagnostic must never mask the run that follows
        blocked("response-shape probe failed: {0}".format(error))
        return None

    blocks = [b for b in body.get("content", []) if isinstance(b, dict)]
    usage = body.get("usage") or {}

    print("  block types returned:")
    for block in blocks:
        kind = block.get("type")
        rendered = block.get("text") or block.get("thinking") or ""
        print("    type={0!r:14} characters={1}".format(kind, len(str(rendered))))
    print("  usage keys: {0}".format(sorted(usage)))
    print("  usage: {0}".format(json.dumps(usage, sort_keys=True)))
    print("  stop_reason: {0}".format(body.get("stop_reason")))

    kinds = [b.get("type") for b in blocks]
    non_text = [k for k in kinds if k != "text"]
    check("DIAG-1 the probe returned content blocks", bool(kinds), "types={0}".format(kinds))

    # This is the fact the whole response-budget design rests on, so it is asserted rather than
    # assumed: if GLM ever stops charging unrendered reasoning to max_tokens, this check goes red
    # and the sizing advice in the server docstring should be revisited.
    check("DIAG-2 the provider bills unrendered reasoning against the output budget",
          bool(non_text),
          "non-text block types={0}; call_glm keeps only type=='text', so these tokens are spent "
          "but never shown".format(non_text))
    check("DIAG-3 the provider reports prompt-cache usage, so input_tokens alone under-reports input",
          "cache_read_input_tokens" in usage, "usage keys={0}".format(sorted(usage)))
    return kinds


def survey_candidates(glm):
    """Print what each candidate scope costs locally, and choose the narrowest usable one."""
    section("SCOPE SURVEY - local only, no API call")
    chosen = None
    for scope in CANDIDATE_SCOPES:
        _, sent, _, total = survey(glm, scope)
        marker = " "
        if chosen is None and total >= SCOPE_MARGIN_BYTES:
            chosen = scope
            marker = "*"
        print("  {0} {1:44} files={2:4}  bytes={3}".format(marker, str(scope), len(sent), total))
    if chosen is None:
        chosen = CANDIDATE_SCOPES[-1]
        print("  no candidate cleared {0} bytes; falling back to {1}".format(
            SCOPE_MARGIN_BYTES, chosen))
    print("  chosen wide scope: {0}".format(chosen))
    return chosen


def build_narrow_scope(glm, wide_scope):
    """The smallest scope built from `wide_scope`'s parts that still clears the old read budget.

    This is the second half of an A/B that varies packet size at a constant response budget: walk
    the wide scope's immediate children in sorted order and stop as soon as the assembled bytes
    pass the margin. It stays comfortably over the old 240,000-byte ceiling, so it proves the
    raised input budget just as well as the wide packet does.

    It was built to test the hypothesis that a smaller packet leaves more of the response budget
    for the report, which is what the server used to advise. The hypothesis was refuted by this
    very construction - the narrowed packet returned a SHORTER report - and the server's text has
    since been corrected to say so. The leg is kept because the refutation is the evidence.
    """
    section("NARROWED SCOPE - the A/B partner: smaller packet, same response budget")
    parts = []
    for parent in wide_scope:
        base = (REPO_ROOT / parent)
        if base.is_dir():
            parts.extend(sorted(
                "{0}/{1}".format(parent, child.name) for child in base.iterdir()))
        else:
            parts.append(parent)

    scope, total = [], 0
    for part in parts:
        scope.append(part)
        _, sent, _, total = survey(glm, scope)
        print("    + {0:52} files={1:4}  bytes={2}".format(part, len(sent), total))
        if total > SCOPE_MARGIN_BYTES:
            break

    if total <= OLD_TOTAL_READ_BUDGET:
        blocked("the narrowed scope assembles only {0} bytes and cannot demonstrate the raised "
                "read budget; falling back to the wide scope".format(total))
        return wide_scope
    print("  chosen narrow scope: {0} entries, {1} bytes".format(len(scope), total))
    return scope


# ------------------------------------------------------------------------------------ delegation

def run_delegation(client, glm, scope, max_tokens, tag, request_id, title):
    """One real delegation, measured end to end.

    Parameterised by response budget because the interesting evidence is the A/B: the same packet,
    the same scope, the same objective, and only max_tokens different. The contract's 16384 case and
    a wider case therefore differ in exactly one variable, which is what makes the comparison mean
    anything about the budget rather than about the model's mood.
    """
    section(title)

    matched, sent, notes, surveyed = survey(glm, scope)
    print("  scope: {0}   max_tokens: {1}".format(scope, max_tokens))
    if surveyed <= OLD_TOTAL_READ_BUDGET:
        blocked("the delegation scope assembles only {0} bytes, which cannot demonstrate the "
                "raised read budget; no API call was made".format(surveyed))
        return None

    before = fingerprint(sent)
    result, text = call_tool(client, request_id, "glm_delegate", {
        "task_id": "awkit-glm-ctx",
        "mode": "investigation",
        "objective": OBJECTIVE,
        "read_scope": scope,
        "max_tokens": max_tokens,
    })
    after = fingerprint(sent)

    report_metrics("Delegation evidence ({0} tokens)".format(max_tokens),
                   text, matched, sent, surveyed)

    if result.get("isError"):
        check(tag + "-1 the live delegation returned a report", False, text[:400])
        return text

    check(tag + "-1 the live delegation returned a report", bool(text.strip()))

    server_bytes = field(text, "Source bytes sent", int)
    check(tag + "-2 the input exceeded the old 240000-byte total read budget",
          server_bytes is not None and server_bytes > OLD_TOTAL_READ_BUDGET,
          "server reported {0} bytes".format(server_bytes))
    check(tag + "-2b the server's own byte accounting matches the local survey",
          server_bytes == surveyed, "server={0} local={1}".format(server_bytes, surveyed))
    check(tag + "-3 files sent is reported and within the configured file budget",
          field(text, "Files sent", int) == len(sent) <= glm.resolve_read_budget().max_files,
          "sent={0}".format(len(sent)))

    requested = leading_int(text, "Requested output budget")
    effective = leading_int(text, "Effective output budget")
    check(tag + "-4 the requested output budget was {0}".format(max_tokens),
          requested == max_tokens, "requested={0}".format(requested))
    check(tag + "-4b the effective output budget was {0}, not clamped".format(max_tokens),
          effective == max_tokens, "effective={0}".format(effective))

    # A prompt-cache hit moves the bulk of the input out of input_tokens and into
    # cache_read_input_tokens, so the two must be added before asking "did the repository slice
    # actually reach the model". Reading input_tokens alone made an identical 432,572-byte packet
    # look like 22 tokens of input on its second run.
    input_tokens = field(text, "Input tokens reported by provider", int)
    cached_tokens = field(text, "Cached input tokens read (provider)", int) or 0
    total_input = (input_tokens or 0) + cached_tokens
    output_tokens = field(text, "Output tokens reported by provider", int)

    check(tag + "-5 the provider accounted for a large input, fresh or cached",
          total_input > 20000,
          "input_tokens={0} + cache_read={1} = {2}".format(input_tokens, cached_tokens, total_input))
    check(tag + "-5b the server discloses the cached portion of the input",
          field(text, "Cached input tokens read (provider)", int) is not None,
          "footer reported cache_read_input_tokens={0}".format(cached_tokens))
    check(tag + "-6 the provider's output stayed inside the requested {0}-token budget".format(
              max_tokens),
          isinstance(output_tokens, int) and 0 < output_tokens <= max_tokens,
          "output_tokens={0}".format(output_tokens))
    check(tag + "-6b the response is compact relative to the input it analysed",
          isinstance(output_tokens, int) and output_tokens < total_input,
          "in={0} out={1}".format(total_input, output_tokens))

    stop_reason = field(text, "Stop reason")
    check(tag + "-7 the report finished on its own rather than hitting max_tokens",
          stop_reason == "end_turn", "stop_reason={0}".format(stop_reason))
    check(tag + "-7b a truncated response would have been flagged",
          (stop_reason != "max_tokens")
          or ("WARNING: the response hit max_tokens and is TRUNCATED" in text))
    check(tag + "-7c the footer accounts for the reasoning the budget was spent on",
          "Non-rendered response blocks:" in text,
          "disclosure line {0}".format(
              "present" if "Non-rendered response blocks:" in text else "MISSING"))

    headings = ["Summary", "Files inspected", "Implementation details", "Assumptions",
                "Architecture concerns", "Regression risks"]
    present = [h for h in headings if h.lower() in text.lower()]
    check(tag + "-8 the report follows the requested structure",
          len(present) >= 5, "found {0} of {1}: {2}".format(len(present), len(headings), present))
    # A report that writes "securityKernel.ts" has named a specific file just as surely as one that
    # writes the full repository-relative path, so both count. What must not count is a vague
    # gesture at "the IPC layer", which is why this looks for filenames and not for directories.
    by_path = [name for name in sent if name in text]
    by_base = [name for name in sent if name.rsplit("/", 1)[-1] in text]
    cited = sorted(set(by_path) | set(by_base))
    check(tag + "-8b the report cites specific files from the scope it was given",
          len(cited) >= 3,
          "cited {0} files ({1} by full path, {2} by basename); first few: {3}".format(
              len(cited), len(by_path), len(by_base), cited[:5]))

    check(tag + "-9 no secret-bearing path was included in the scope that was sent",
          not any(hint in name.lower() for name in sent for hint in glm.SECRET_NAME_HINTS),
          "sent={0}".format(sent[:5]))
    check(tag + "-10 the delegate performed no repository modification",
          before == after,
          "changed: {0}".format([k for k in before if before[k] != after.get(k)]))

    return text


# ---------------------------------------------------------------------------------- review

def run_review(client, glm, scope, max_tokens, request_id):
    section("LIVE glm_review - regression, at the raised read capacity")

    matched, sent, notes, surveyed = survey(glm, scope)
    print("  scope: {0}   max_tokens: {1}".format(scope, max_tokens))

    before = fingerprint(sent)
    arguments = {
        "target": "AWKIT Electron main-process IPC surface",
        "read_scope": scope,
        "review_against": [
            "docs/ai/RULES.md offline-first and IPC contract rules",
            "AGENTS.md security rules on secret handling and authorization",
        ],
        "focus": ["authorization and RBAC issues", "IPC and preload contract compatibility",
                  "concurrency and cancellation"],
    }
    # None means "send no max_tokens at all", which is what exercises the shipped default.
    if max_tokens is not None:
        arguments["max_tokens"] = max_tokens

    result, text = call_tool(client, request_id, "glm_review", arguments)
    after = fingerprint(sent)

    report_metrics("Review evidence", text, matched, sent, surveyed)

    if result.get("isError"):
        check("RV-L1 the live review returned findings", False, text[:400])
        return text

    check("RV-L1 the live review returned findings", bool(text.strip()))
    check("RV-L2 the review received more than the old 240000-byte read budget",
          surveyed > OLD_TOTAL_READ_BUDGET, "bytes={0}".format(surveyed))

    severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "OBSERVATION"]
    missing = [s for s in severities if s not in text]
    check("RV-L3 the CRITICAL/HIGH/MEDIUM/LOW/OBSERVATION structure is preserved",
          not missing, "missing {0}".format(missing))

    expected = REQUESTED_MAX_TOKENS if max_tokens is None else max_tokens
    output_tokens = field(text, "Output tokens reported by provider", int)
    check("RV-L4 the review resolved to the {0} response budget".format(expected),
          leading_int(text, "Effective output budget") == expected,
          "effective={0} (max_tokens {1})".format(
              leading_int(text, "Effective output budget"),
              "not sent - shipped default" if max_tokens is None else max_tokens))
    check("RV-L5 the review's output stayed inside that budget",
          isinstance(output_tokens, int) and 0 < output_tokens <= expected,
          "output_tokens={0}".format(output_tokens))
    check("RV-L5b the review finished on its own rather than hitting max_tokens",
          field(text, "Stop reason") == "end_turn",
          "stop_reason={0}".format(field(text, "Stop reason")))
    check("RV-L6 the review performed no repository modification", before == after,
          "changed: {0}".format([k for k in before if before[k] != after.get(k)]))

    return text


# ------------------------------------------------------------------------- one leg per invocation

class _Tee(io.TextIOBase):
    """Write to the live console and to a buffer at once.

    The buffer is what gets persisted, so the final invocation can replay every leg's transcript
    into one report; the console copy is what makes a ten-minute leg watchable while it runs.
    """

    def __init__(self, *streams):
        self._streams = streams

    def write(self, data):
        for stream in self._streams:
            stream.write(data)
        return len(data)

    def flush(self):
        for stream in self._streams:
            try:
                stream.flush()
            except (OSError, ValueError):
                pass


def build_fingerprint():
    """Content hashes of the server and both verifiers.

    A resumed run must never staple a leg from one build onto legs from another and report the
    result as one verdict, so the state carries this and is discarded the moment it stops matching.
    Content, not mtime: a checkout can hand a stale file a fresh timestamp.
    """
    parts = []
    for path in (HERE / "glm_delegate_server.py", HERE / "verify_glm_delegate.py",
                 Path(__file__).resolve()):
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            digest = "unreadable"
        parts.append("{0}:{1}".format(path.name, digest))
    return " ".join(parts)


def new_state():
    return {"build": build_fingerprint(), "started": time.time(), "stages": {}, "attempts": {}}


def load_state():
    """The partial run to continue, or a fresh one - and it says out loud which it chose."""
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return new_state()

    if not isinstance(state, dict) or not isinstance(state.get("stages"), dict):
        return new_state()
    if state.get("build") != build_fingerprint():
        print("  starting over: the server or a verifier changed on disk since the last leg ran")
        return new_state()
    try:
        age = time.time() - float(state.get("started", 0))
    except (TypeError, ValueError):
        return new_state()
    if age > STATE_MAX_AGE_SECONDS:
        print("  starting over: the previous partial run is {0:.1f} hours old".format(age / 3600.0))
        return new_state()
    if all(name in state["stages"] for name in STAGES):
        print("  starting over: the previous run completed every leg")
        return new_state()
    state.setdefault("attempts", {})
    return state


def save_state(state):
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def open_client():
    """A freshly spawned server, initialized, exactly as .mcp.json spawns it."""
    client = harness.McpClient(
        env_overrides={"GLM_MCP_TIMEOUT_SECONDS": SERVER_TIMEOUT_SECONDS})
    reply = client.request(1, "initialize", {
        "protocolVersion": "2025-06-18", "capabilities": {},
        "clientInfo": {"name": "verify-glm-delegate-live", "version": "1.0.0"}})
    client.notify("notifications/initialized")
    return client, reply


def stage_probe(glm, state):
    """Everything that costs almost nothing, plus the scope decisions the later legs inherit.

    The chosen scopes are written into the state rather than recomputed per leg, so the wide leg,
    the narrow leg and the review all provably ran against the same byte counts this leg printed.
    """
    probe_response_shape(glm)
    wide = survey_candidates(glm)
    narrow = build_narrow_scope(glm, wide)
    state["wide_scope"] = wide
    state["narrow_scope"] = narrow

    client, reply = open_client()
    try:
        check("LIVE-0 a freshly spawned server initialized",
              (reply.get("result") or {}).get("protocolVersion") == "2025-06-18")
    finally:
        client.close()


def scopes(glm, state):
    """The scopes the probe leg chose, or - if the state lost them - the same computation, quietly.

    The recomputation prints nothing and leaves the BLOCKED ledger as it found it, because this is
    not the leg that reports on scope selection; only the probe leg's transcript does.
    """
    if state.get("wide_scope") and state.get("narrow_scope"):
        return state["wide_scope"], state["narrow_scope"]
    snapshot = list(_BLOCKED)
    with contextlib.redirect_stdout(io.StringIO()):
        wide = survey_candidates(glm)
        narrow = build_narrow_scope(glm, wide)
    _BLOCKED[:] = snapshot
    return wide, narrow


# Two delegations at the SAME 16384 budget, differing only in how wide the packet is.
#
# An earlier design varied max_tokens instead, and it was the wrong experiment twice over: a
# 432,572-byte packet at 32768 exceeded the 900s server timeout and returned no report at all, so it
# measured generation latency rather than the budget. Varying the packet was the right experiment
# and it refuted the server's own former advice - see the module docstring. Both packets clear the
# old 240,000-byte ceiling, so either one proves the raised input budget on its own.

def stage_wide(glm, state):
    wide, _ = scopes(glm, state)
    client, _reply = open_client()
    try:
        run_delegation(client, glm, wide, REQUESTED_MAX_TOKENS, "LD", 100,
                       "LIVE glm_delegate - widest packet, contract-mandated 16384 budget")
    finally:
        client.close()


def stage_narrow(glm, state):
    _, narrow = scopes(glm, state)
    client, _reply = open_client()
    try:
        run_delegation(client, glm, narrow, REQUESTED_MAX_TOKENS, "LD2", 150,
                       "LIVE glm_delegate - narrowed packet, same 16384 budget")
    finally:
        client.close()


def stage_review(glm, state):
    # The review runs at its DEFAULT budget - nothing passed - so the regression case exercises the
    # shipped default rather than a budget chosen to flatter it.
    _, narrow = scopes(glm, state)
    client, _reply = open_client()
    try:
        run_review(client, glm, narrow, None, 200)
    finally:
        client.close()


STAGE_RUNNERS = {
    "probe": stage_probe,
    "wide": stage_wide,
    "narrow": stage_narrow,
    "review": stage_review,
}


def aggregate(state):
    """Replay every leg's transcript, then print the single verdict for the whole run."""
    print("\n" + "=" * 72)
    print("ALL LEGS COMPLETE - replaying the full transcript")

    results, blocked_reasons = [], []
    for name in STAGES:
        leg = state["stages"][name]
        # Abandoned attempts are replayed before the one that counted, because a leg that needed
        # three tries is a different piece of evidence from one that passed first time, and only
        # the transcript can tell them apart. Their checks do NOT enter the tally: the retry rule
        # already decided they measured provider latency rather than the budget under test.
        for index, earlier in enumerate(state.get("attempts", {}).get(name, []), start=1):
            print("\n" + "-" * 72)
            print("LEG {0}  attempt {1} - ABANDONED on the provider timeout, not counted  "
                  "({2}s)".format(name, index, earlier.get("elapsed")))
            print("-" * 72)
            print(earlier.get("transcript", "").rstrip("\n"))

        print("\n" + "-" * 72)
        print("LEG {0}  ({1}s)".format(name, leg.get("elapsed")))
        print("-" * 72)
        print(leg.get("transcript", "").rstrip("\n"))
        results.extend(tuple(entry) for entry in leg.get("results", []))
        blocked_reasons.extend(leg.get("blocked", []))

    passed = sum(1 for ok, _ in results if ok)
    failed = [name for ok, name in results if not ok]

    print("\n" + "=" * 72)
    print("verify:glm-delegate-live  {0} PASS / {1} FAIL / {2} BLOCKED  ({3} checks)".format(
        passed, len(failed), len(blocked_reasons), len(results)))
    if failed:
        print("\nFAILED:")
        for name in failed:
            print("  - " + name)
    if blocked_reasons:
        print("\nBLOCKED:")
        for reason in blocked_reasons:
            print("  - " + reason)
    return 1 if (failed or blocked_reasons) else 0


# ------------------------------------------------------------------------------------------ main

def main():
    print("verify:glm-delegate-live - REAL GLM delegations over the MCP stdio path")
    print("repo:  {0}".format(REPO_ROOT))

    key = os.environ.get("GLM_API_KEY", "").strip()
    if not key or key.startswith("${"):
        print("\n" + "=" * 72)
        print("verify:glm-delegate-live  BLOCKED - GLM_API_KEY is not set in this environment.")
        print("No API call was attempted. This is not a PASS and not a FAIL.")
        return 3

    state = load_state()
    pending = [name for name in STAGES if name not in state["stages"]]
    stage = pending[0]
    prior_attempts = state.get("attempts", {}).get(stage, [])
    print("  state: {0}".format(STATE_PATH))
    print("  leg {0} of {1}: {2}   (done: {3})".format(
        len(STAGES) - len(pending) + 1, len(STAGES), stage,
        ", ".join(name for name in STAGES if name in state["stages"]) or "none"))
    if prior_attempts:
        print("  attempt {0} of {1} - {2} earlier attempt(s) ended in the provider's own timeout "
              "and were not counted".format(
                  len(prior_attempts) + 1, MAX_LEG_ATTEMPTS, len(prior_attempts)))

    glm = harness.load_server()

    buffer = io.StringIO()
    console = sys.stdout
    started = time.time()
    sys.stdout = _Tee(console, buffer)
    try:
        STAGE_RUNNERS[stage](glm, state)
    finally:
        sys.stdout = console

    elapsed = time.time() - started
    transcript = buffer.getvalue()
    record = {
        "transcript": transcript,
        "results": [[bool(ok), name] for ok, name in harness._RESULTS],
        "blocked": list(_BLOCKED),
        "elapsed": round(elapsed, 1),
    }

    leg_failed = [name for ok, name in harness._RESULTS if not ok]
    print("\n" + "-" * 72)
    print("leg {0}: {1} PASS / {2} FAIL / {3} BLOCKED in {4:.1f}s".format(
        stage, sum(1 for ok, _ in harness._RESULTS if ok), len(leg_failed), len(_BLOCKED), elapsed))

    # Only the provider's own timeout earns another try, and only while tries remain. Anything else
    # that failed is the result: it is banked and the run moves on.
    retryable = (leg_failed
                 and PROVIDER_TIMEOUT_MARKER in transcript
                 and len(prior_attempts) + 1 < MAX_LEG_ATTEMPTS)
    if retryable:
        state.setdefault("attempts", {}).setdefault(stage, []).append(record)
        save_state(state)
        print("this attempt ended in the server's {0}s timeout, which measures latency rather than "
              "the budget under test; it is kept in the transcript but not counted".format(
                  SERVER_TIMEOUT_SECONDS))
        print("run `npm run verify:glm-delegate-live` again to re-attempt leg {0} ({1} of {2})"
              .format(stage, len(prior_attempts) + 2, MAX_LEG_ATTEMPTS))
        return 2

    state["stages"][stage] = record
    save_state(state)

    remaining = [name for name in STAGES if name not in state["stages"]]
    if remaining:
        print("no verdict yet - {0} leg(s) remain: {1}".format(
            len(remaining), ", ".join(remaining)))
        print("run `npm run verify:glm-delegate-live` again to continue")
        return 2

    return aggregate(state)


if __name__ == "__main__":
    sys.exit(main())
