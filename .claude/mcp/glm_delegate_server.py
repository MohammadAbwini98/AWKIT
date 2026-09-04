#!/usr/bin/env python3
"""
GLM-5.3 delegated-worker MCP server for AWKIT (SpecterStudio).

WHAT THIS IS
    A stdio MCP server that lets the AWKIT Manager hand a *bounded* packet of read-only work to
    GLM-5.3 through the Z.AI Anthropic-compatible Messages API, and get a report back. It exists so
    that heavy repository analysis does not have to be paid for out of the Manager's context.

    It is the same mechanism SpecterERP already uses, ported to this repository's governance. It is
    not a second GLM integration and not a second provider.

WHAT THIS IS NOT
    It is not an agent framework and not a second orchestrator. GLM has no filesystem write
    capability here at all: it reads what the packet names, and it returns text. The AWKIT Manager
    applies, validates and owns every resulting change.

    That is not a stylistic preference. AWKIT serializes every repository write behind a single
    write lease (tools/agents/lease.mjs, enforced by tools/agents/lease-guard.mjs), and commits go
    directly to the single `main` branch. A second process with independent write access would
    defeat the lease without ever appearing in it. Bounding GLM to "read the named scope, return a
    report" makes the one-active-write-owner rule mechanical rather than merely documented.

    Governance: AGENTS.md, docs/ai/RULES.md, docs/ai/BRANCH_AND_COMMIT_POLICY.md, and the routing
    and lease rules in tools/agents/.

DEVELOPMENT TOOLING ONLY
    This file is agent tooling. It is not part of the AWKIT product, it is never bundled, packaged
    or shipped, and nothing under app/, src/, scripts/ or resources/ may import, spawn or depend on
    it. It runs only when a developer's MCP client starts it. AWKIT's offline-first guarantee is a
    statement about the packaged application at runtime and is unaffected by it.

DEPENDENCIES
    None. Python 3.9+ standard library only, so there is no supply chain to trust and nothing to
    install or keep up to date. Python is a prerequisite of the developer's MCP client, never of
    AWKIT itself.

CREDENTIALS
    Read from the environment only - GLM_API_KEY. No key is stored in this file, in .mcp.json, or
    anywhere else in the repository, and no code path here prints, logs or returns the key value.

ENVIRONMENT
    GLM_API_KEY               required at call time; absent is a clear error, not a crash
    GLM_MODEL                 default glm-5.3
    GLM_BASE_URL              default https://api.z.ai/api/anthropic
    GLM_MCP_TIMEOUT_SECONDS   default 900
    GLM_MCP_MAX_TOKENS        default 16384
    GLM_MCP_REPO_ROOT         default: nearest ancestor of this file holding AGENTS.md + package.json
"""

import json
import os
import sys
import textwrap
import urllib.error
import urllib.request
from pathlib import Path

SERVER_NAME = "glm-delegate"
SERVER_VERSION = "1.0.0"

# Echoed back to the client when it asks for one of these; otherwise we answer with our newest.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
DEFAULT_PROTOCOL_VERSION = "2025-06-18"

DEFAULT_MODEL = "glm-5.3"
DEFAULT_BASE_URL = "https://api.z.ai/api/anthropic"
DEFAULT_TIMEOUT_SECONDS = 900
DEFAULT_MAX_TOKENS = 16384

# Context budget for files the server reads on the Manager's behalf. Delegation is supposed to
# *save* context, so these caps are deliberately modest - a packet that needs more than this is a
# packet that was not bounded tightly enough.
MAX_FILE_BYTES = 80_000
MAX_TOTAL_BYTES = 240_000
MAX_FILES = 60

READABLE_SUFFIXES = {
    ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx",
    ".json", ".jsonl", ".md", ".css", ".html", ".yml", ".yaml",
    ".sql", ".ps1", ".sh", ".py", ".txt", ".editorconfig", ".xml", ".nsh", ".nsi",
}

# Build outputs and derived artifacts. graphify-out/ is a derived knowledge graph, not source, and
# reading it back into a prompt would spend the read budget on something the repository can rebuild.
SKIP_DIRECTORIES = {
    "node_modules", ".git", "dist", "out", "release", "build",
    "graphify-out", "coverage", "playwright-report", "test-results",
    ".vs", ".idea", ".turbo", "resources/browsers",
}

# Names that must never be read into a prompt, regardless of what a packet asks for. This is a
# denylist over the repository-relative path - every segment, not just the basename - applied after
# the repository-root containment check. Matching the basename alone would refuse issuer-keys.json
# while happily reading issuer-keys/anything.json, which is the case that actually matters.
#
# Note what is deliberately ABSENT: "license". AWKIT's licensing subsystem (src/licensing/**,
# app/main/licensing/**) is ordinary source that analysis of the run gates has to read. The private
# issuer key lives outside the repository under %LOCALAPPDATA%/SpecterStudio/issuer-keys, and
# "issuer-keys" is blocked below; the shipped public key is not a secret.
SECRET_NAME_HINTS = (
    "credential", "secret", ".env", "id_rsa", ".pem", ".pfx", ".p12", ".key",
    "storage-state", "auth-state", "session-profiles", "issuer-keys",
    "settings.local.json",
)


# --------------------------------------------------------------------------- worker constraints

# AWKIT's evidence ranking, mirrored from CLAUDE.md (graphify section) and AGENTS.md. THOSE FILES
# ARE CANONICAL. This tuple is the single source for the ordering injected into every delegated
# prompt; if it and they ever disagree, they win and this constant is the defect.
#
# It is a constant rather than prose because the ordering is the whole point of delegating to a
# model that cannot run anything: a delegate that ranks its own reasoning above the source, or the
# derived graph above the source, produces confident findings about code that does not exist.
CANONICAL_EVIDENCE_ORDER = (
    "source code",
    "tests and verifiers, and only when actually executed",
    "Git state",
    "docs/ai/ and AGENTS.md",
    "the graphify knowledge graph (a retrieval hint, never proof of runtime behaviour)",
    "agent reports, including yours",
)

_HIERARCHY = textwrap.fill(
    " -> ".join(CANONICAL_EVIDENCE_ORDER),
    width=92, initial_indent="    ", subsequent_indent="    ")

# Sent as the system prompt on every call. A delegated worker has no memory of this repository's
# governance between calls, so the worker-level constraints are restated on each request.
WORKER_CONSTRAINTS = f"""\
You are GLM-5.3, acting as a DELEGATED WORKER inside the AWKIT (SpecterStudio) repository. AWKIT is
an offline-capable Windows desktop application - Electron main process, React renderer, TypeScript,
Playwright automation - and it is governed by a deterministic agent routing matrix with a single
serialized write lease. You have been given a bounded packet of work by the AWKIT Manager, which
owns this repository's delivery process.

Your position in the evidence hierarchy, which you may not change. This mirrors CLAUDE.md and
AGENTS.md, which are canonical - if this text and those files ever disagree, they win, this text is
the defect, and you should report that you saw it:

{_HIERARCHY}

The AWKIT Manager decides everything. Your report is the last entry above: not authoritative at all.

Binding constraints:

1.  You are a worker and reviewer. You are not an orchestrator, not a project manager, and not an
    owner of task state, the write lease, Beads issues, or the roadmap.
2.  You have NO ability to write to the repository. You return text. The AWKIT Manager applies,
    validates and owns every change that results from your work. Never claim to have edited,
    created or deleted a file.
3.  You cannot execute anything - no build, no verifier, no test, no Git command. Never report a
    command result you did not receive in this packet. AWKIT's evidence vocabulary is
    PASS / FAIL / BLOCKED / NOT RUN / NOT APPLICABLE, and missing evidence is NOT RUN. Converting
    missing evidence into PASS is the single worst failure available to you here.
4.  You MUST NOT claim a task is complete and MUST NOT report a status of DONE. Completion in this
    repository means the Manager validated it against executed evidence. Say what you read and what
    you observed; the completion decision is not yours.
5.  Stay inside the declared scope. If you find a real problem outside it, REPORT it - name the file
    and the evidence - and do not fold it into this change. The Manager decides whether follow-up
    work is created.
6.  Do not substitute your preferred pattern, framework, dependency, module boundary, authorization
    mechanism, queue, or persistence strategy for an existing one. AWKIT's non-negotiable rules
    (docs/ai/RULES.md) include: offline-first with no runtime network and no CDN or remote asset; no
    new npm dependency without explicit authorization; mutable data only under
    %LOCALAPPDATA%/SpecterStudio/ and never inside resources/ or app.asar; UI styling only through
    the Hologram design tokens in app/renderer/styles/global.css; and the preload identifier
    window.playwrightFlowStudio must never be renamed. If the packet appears to contradict one of
    these, stop and report the contradiction rather than resolving it yourself.
7.  Never propose weakening, deleting or relaxing an existing guard, verifier assertion,
    authorization check, licensing checkpoint or capacity limit in order to make a change pass. If a
    guard blocks the objective, that is a finding to report, not an obstacle to remove.
8.  Do not delegate this work onward to any other model or agent.
9.  Report uncertainty as uncertainty. A guess presented as a finding is worse than no finding,
    because the Manager may spend a whole verification cycle disproving it.
10. Distinguish what you verified from what you inferred. You are reading a curated slice of the
    repository, not all of it; say so wherever that limits a conclusion.
"""

IMPLEMENTATION_INSTRUCTIONS = """\
MODE: {mode}

Produce the work described by the objective, as text the AWKIT Manager can apply. Where you propose
code, give complete file contents or precisely anchored changes - never an unanchored fragment.

Return your response under exactly these headings:

1. Summary
2. Files inspected
3. Files changed (proposed - state that these are proposals for the AWKIT Manager to apply)
4. Implementation details
5. Tests/builds executed (you cannot execute anything; state NONE and name what should be run)
6. Exact results (NOT RUN, for the same reason; never invent a result and never write PASS)
7. Assumptions
8. Unresolved issues
9. Architecture concerns
10. Security / data-integrity concerns
11. Regression risks

Do not mark the task complete. The AWKIT Manager will independently validate this work.
"""

REVIEW_INSTRUCTIONS = """\
MODE: READ-ONLY REVIEW

You are performing an independent review. Do not propose to modify files; produce findings.

Group every finding under these headings, in this order, omitting none even if empty:

CRITICAL
HIGH
MEDIUM
LOW
OBSERVATION

Every finding MUST carry:

-   evidence (quote or cite the specific code or artifact you are relying on);
-   file and location;
-   the violated requirement, invariant, rule or contract where one applies;
-   impact;
-   recommended remediation.

Where you cannot verify something from the material provided, say so explicitly rather than assuming
it is correct or incorrect. Do not claim authoritative task completion, and do not report any
command as passing - you ran nothing.
"""


# --------------------------------------------------------------------------------- repository io

def repo_root() -> Path:
    """Repository root: the environment override, else the nearest ancestor that looks like AWKIT."""
    override = os.environ.get("GLM_MCP_REPO_ROOT", "").strip()
    if override and not override.startswith("${"):
        candidate = Path(override).expanduser()
        if candidate.is_dir():
            return candidate.resolve()

    here = Path(__file__).resolve()
    for directory in (here.parent, *here.parents):
        if (directory / "AGENTS.md").exists() and (directory / "package.json").exists():
            return directory
    return Path.cwd().resolve()


def _is_readable_file(path: Path, root: Path) -> bool:
    """A readable text type whose repository-relative path carries no secret-bearing segment."""
    name = path.name.lower()
    try:
        candidate = path.relative_to(root).as_posix().lower()
    except ValueError:
        candidate = name
    if any(hint in candidate for hint in SECRET_NAME_HINTS):
        return False
    return path.suffix.lower() in READABLE_SUFFIXES or name in {"agents.md", "claude.md", "gemini.md"}


def _is_skipped(path: Path, root: Path) -> bool:
    """True when any path segment below the root names a build output or derived artifact."""
    try:
        relative = path.relative_to(root)
    except ValueError:
        return True
    parts = relative.parts
    if any(part in SKIP_DIRECTORIES for part in parts):
        return True
    # Multi-segment entries such as "resources/browsers" are matched as a prefix pair.
    joined = "/".join(parts)
    return any("/" in skip and joined.startswith(skip + "/") for skip in SKIP_DIRECTORIES)


def _expand_scope(root: Path, entries):
    """Resolve packet scope entries to files, refusing anything outside the repository root."""
    files, notes = [], []

    for raw in entries or []:
        entry = str(raw).strip().replace("\\", "/")
        if not entry:
            continue

        target = Path(entry).resolve() if Path(entry).is_absolute() else (root / entry).resolve()

        try:
            target.relative_to(root)
        except ValueError:
            notes.append("REFUSED (outside repository root): " + entry)
            continue

        if target.is_file():
            if _is_readable_file(target, root):
                files.append(target)
            else:
                notes.append("SKIPPED (not a readable text type, or secret-bearing path): " + entry)
        elif target.is_dir():
            for child in sorted(target.rglob("*")):
                if child.is_file() and _is_readable_file(child, root) and not _is_skipped(child, root):
                    files.append(child)
        else:
            notes.append("NOT FOUND: " + entry)

    unique, seen = [], set()
    for path in files:
        if path not in seen:
            seen.add(path)
            unique.append(path)

    if len(unique) > MAX_FILES:
        notes.append(
            "SCOPE TOO WIDE: {0} files matched; the first {1} were included. Narrow the read "
            "scope - a packet this wide is not a bounded delegation.".format(len(unique), MAX_FILES))
        unique = unique[:MAX_FILES]

    return unique, notes


def read_scope_text(root: Path, entries):
    """Read the named scope into a prompt section, with the caps and omissions stated in-band."""
    files, notes = _expand_scope(root, entries)
    blocks, total = [], 0

    for path in files:
        relative = path.relative_to(root).as_posix()
        try:
            data = path.read_text(encoding="utf-8", errors="replace")
        except OSError as error:
            notes.append("UNREADABLE: {0} ({1})".format(relative, error))
            continue

        encoded = data.encode("utf-8")
        if len(encoded) > MAX_FILE_BYTES:
            data = encoded[:MAX_FILE_BYTES].decode("utf-8", errors="ignore")
            data += "\n\n[TRUNCATED at {0} bytes - this file is incomplete]".format(MAX_FILE_BYTES)
            notes.append("TRUNCATED: " + relative)

        if total + len(data.encode("utf-8")) > MAX_TOTAL_BYTES:
            notes.append("OMITTED (total read budget of {0} bytes reached): {1}".format(
                MAX_TOTAL_BYTES, relative))
            continue

        total += len(data.encode("utf-8"))
        blocks.append("----- FILE: {0} -----\n{1}\n----- END: {0} -----".format(relative, data))

    included = [path.relative_to(root).as_posix() for path in files]
    return "\n\n".join(blocks), included, notes


# ------------------------------------------------------------------------------------ z.ai call

def _configured_key():
    key = os.environ.get("GLM_API_KEY", "").strip()
    # A literal placeholder means the launcher did not expand it; that is unset, not a key, and
    # failing here beats sending a nonsense credential to the endpoint.
    if not key or key.startswith("${"):
        return None
    return key


def _setting(name, default, cast=str):
    raw = os.environ.get(name, "").strip()
    if not raw or raw.startswith("${"):
        return default
    try:
        return cast(raw)
    except (TypeError, ValueError):
        return default


def call_glm(system_prompt: str, user_prompt: str, max_tokens: int):
    """One Messages API call against the Z.AI Anthropic-compatible endpoint."""
    key = _configured_key()
    if key is None:
        raise RuntimeError(
            "GLM_API_KEY is not set in this environment, so the GLM delegate cannot be reached.\n"
            "Set it once with:  setx GLM_API_KEY \"YOUR_ZAI_API_KEY\"\n"
            "then open a new terminal and restart Claude Code so the variable is inherited.\n"
            "No key is stored in the repository by design.")

    base = _setting("GLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    model = _setting("GLM_MODEL", DEFAULT_MODEL)
    timeout = _setting("GLM_MCP_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, int)

    payload = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }).encode("utf-8")

    request = urllib.request.Request(
        base + "/v1/messages",
        data=payload,
        method="POST",
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": key,
            "authorization": "Bearer " + key,
            "user-agent": SERVER_NAME + "/" + SERVER_VERSION,
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(
            "GLM endpoint returned HTTP {0}. Endpoint: {1}. Model: {2}.\nResponse: {3}\n"
            "Treat this as a delegation failure, not as a completed task: nothing was written, and "
            "the analysis this packet asked for has NOT RUN.".format(
                error.code, base, model, detail)) from None
    except urllib.error.URLError as error:
        raise RuntimeError(
            "Could not reach the GLM endpoint at {0}: {1}.\n"
            "Treat this as a delegation failure, not as a completed task.".format(
                base, error.reason)) from None
    except TimeoutError:
        raise RuntimeError(
            "GLM call exceeded the {0}s timeout. Nothing was written here - no repository state "
            "changed. Re-scope the packet smaller, or raise GLM_MCP_TIMEOUT_SECONDS.".format(
                timeout)) from None

    text = "".join(
        block.get("text", "")
        for block in body.get("content", [])
        if isinstance(block, dict) and block.get("type") == "text"
    ).strip()

    usage = body.get("usage") or {}
    stop_reason = body.get("stop_reason")

    footer = [
        "",
        "---",
        "Delegate: {0} via {1}".format(body.get("model", model), base),
        "Tokens: in={0} out={1}".format(
            usage.get("input_tokens", "?"), usage.get("output_tokens", "?")),
    ]
    if stop_reason == "max_tokens":
        footer.append(
            "WARNING: the response hit max_tokens and is TRUNCATED. It is incomplete output, not a "
            "finished report - do not treat it as a full result.")

    return (text or "[GLM returned no text content]") + "\n".join(footer)


# ------------------------------------------------------------------------------ prompt assembly

def _bullets(title, values):
    values = [str(v).strip() for v in (values or []) if str(v).strip()]
    if not values:
        return ""
    body = "\n".join("- " + v for v in values)
    return "\n{0}:\n{1}\n".format(title, body)


def build_delegation_prompt(root: Path, args: dict):
    mode = str(args.get("mode", "implementation")).strip() or "implementation"

    scope_text, included, notes = read_scope_text(root, args.get("read_scope"))

    parts = [
        "### GLM Delegation Packet",
        "",
        "Task:\n" + str(args.get("task_id", "(unassigned)")),
        "",
        "Mode:\n" + mode,
        "",
        "Objective:\n" + str(args.get("objective", "")).strip(),
    ]

    parts.append(_bullets("Authoritative requirements", args.get("requirements")))
    parts.append(_bullets("Dependencies", args.get("dependencies")))
    parts.append(_bullets("Relevant artifacts", args.get("artifacts")))
    parts.append(_bullets("Allowed read scope", args.get("read_scope")))
    parts.append(_bullets("Allowed write scope (proposals only - you cannot write)",
                          args.get("write_scope")))

    prohibited = list(args.get("prohibited_scope") or [])
    prohibited += [
        "unrelated modules",
        "AGENTS.md, CLAUDE.md and docs/ai/RULES.md",
        "the agent control plane: tools/agents/** and docs/ai/contracts/**",
        "derived roadmap output under tools/roadmap/ - it is re-parsed from sources, never hand-edited",
        "Beads state under .beads/ and the validation ledger",
        "files covered by another agent's active write lease",
    ]
    parts.append(_bullets("Prohibited scope", prohibited))

    parts.append(_bullets("Architectural constraints", args.get("architectural_constraints")))
    parts.append(_bullets("Invariants", args.get("invariants")))
    parts.append(_bullets("Validation the AWKIT Manager will run", args.get("validation")))

    if str(args.get("context", "")).strip():
        parts.append("\nAdditional context from the Manager:\n"
                     + str(args["context"]).strip() + "\n")

    parts.append(
        "\nActive ownership:\n"
        "- This delegated scope is assigned to you for the duration of this packet.\n"
        "- Confine every proposal to the allowed write scope above.\n"
        "- The repository write lease is held by the AWKIT Manager, not by you.\n")

    if notes:
        parts.append(_bullets(
            "Scope resolution notes (read these - your evidence base is incomplete where they "
            "say so)", notes))

    if scope_text:
        parts.append("\n### Repository files in the allowed read scope\n\n" + scope_text + "\n")
    else:
        parts.append("\n### Repository files in the allowed read scope\n\n(none provided)\n")

    parts.append("\n" + IMPLEMENTATION_INSTRUCTIONS.format(mode=mode))

    return "\n".join(part for part in parts if part), included, notes


def build_review_prompt(root: Path, args: dict):
    scope_text, included, notes = read_scope_text(root, args.get("read_scope"))

    parts = [
        "### GLM Independent Review",
        "",
        "Target:\n" + str(args.get("target", "(unspecified)")),
        "",
        "Mode:\nREAD-ONLY REVIEW",
        "",
        "Do not propose modifications to repository files. Produce findings only.",
    ]

    parts.append(_bullets("Review against", args.get("review_against")))
    parts.append(_bullets("Evaluate specifically", args.get("focus") or [
        "requirement compliance",
        "missing implementation",
        "architecture violations",
        "security issues",
        "authorization and RBAC issues",
        "licensing checkpoint integrity",
        "IPC and preload contract compatibility",
        "offline-first violations",
        "persisted-shape and migration risk",
        "concurrency and cancellation",
        "edge cases",
        "missing or vacuous tests",
        "regressions",
        "unnecessary scope expansion",
    ]))

    if str(args.get("context", "")).strip():
        parts.append("\nAdditional context from the Manager:\n"
                     + str(args["context"]).strip() + "\n")

    if notes:
        parts.append(_bullets(
            "Scope resolution notes (your evidence base is incomplete where these say so)", notes))

    parts.append("\n### Material under review\n\n" + (scope_text or "(none provided)") + "\n")
    parts.append("\n" + REVIEW_INSTRUCTIONS)

    return "\n".join(part for part in parts if part), included, notes


# --------------------------------------------------------------------------------------- tools

TOOLS = [
    {
        "name": "glm_delegate",
        "description": (
            "Delegate one BOUNDED unit of work to GLM-5.3 as a worker: isolated analysis, a "
            "responsibility inventory, a call graph, focused test design, or repetitive work. GLM "
            "reads the files you name and returns a structured report as text - it cannot write to "
            "the repository and cannot run anything. You apply, validate and own the result. Never "
            "treat its report as evidence; evidence in AWKIT is an executed command."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["task_id", "objective", "read_scope"],
            "properties": {
                "task_id": {"type": "string", "description": "Task or bead identifier, e.g. awkit-r2."},
                "mode": {
                    "type": "string",
                    "enum": ["implementation", "investigation", "test_creation"],
                    "description": "Kind of work. Use glm_review for read-only review.",
                },
                "objective": {"type": "string", "description": "Precise objective for this packet."},
                "requirements": {"type": "array", "items": {"type": "string"},
                                 "description": "Authoritative requirement or acceptance-criterion text."},
                "dependencies": {"type": "array", "items": {"type": "string"},
                                 "description": "Predecessor work that must already be complete."},
                "artifacts": {"type": "array", "items": {"type": "string"},
                              "description": "Contracts, docs/ai/ documents, rules or decisions that bind this work."},
                "read_scope": {"type": "array", "items": {"type": "string"},
                               "description": "Repository-relative files or directories the server reads and sends. Keep it narrow."},
                "write_scope": {"type": "array", "items": {"type": "string"},
                                "description": "Files GLM may propose changes to. Must sit inside the Manager's active write lease."},
                "prohibited_scope": {"type": "array", "items": {"type": "string"},
                                     "description": "Extra exclusions beyond the standing ones."},
                "architectural_constraints": {"type": "array", "items": {"type": "string"}},
                "invariants": {"type": "array", "items": {"type": "string"}},
                "validation": {"type": "array", "items": {"type": "string"},
                               "description": "Commands you will run to validate the returned work."},
                "context": {"type": "string", "description": "Any further curated context."},
                "max_tokens": {"type": "integer", "description": "Response budget. Default 16384."},
            },
        },
    },
    {
        "name": "glm_review",
        "description": (
            "Ask GLM-5.3 for an INDEPENDENT READ-ONLY review of code or artifacts - a second "
            "opinion from a different model. Safe to run against code under an active write lease, "
            "because review takes no write ownership. Findings come back grouped "
            "CRITICAL/HIGH/MEDIUM/LOW/OBSERVATION with evidence. You adjudicate them against the "
            "evidence hierarchy; a finding is a claim, not a defect."
        ),
        "inputSchema": {
            "type": "object",
            "required": ["target", "read_scope"],
            "properties": {
                "target": {"type": "string", "description": "Task, changeset or files under review."},
                "read_scope": {"type": "array", "items": {"type": "string"},
                               "description": "Repository-relative files or directories to review."},
                "review_against": {"type": "array", "items": {"type": "string"},
                                   "description": "The requirements, rules, invariants or contract text the target must satisfy."},
                "focus": {"type": "array", "items": {"type": "string"},
                          "description": "Override the default evaluation list."},
                "context": {"type": "string"},
                "max_tokens": {"type": "integer", "description": "Response budget. Default 16384."},
            },
        },
    },
    {
        "name": "glm_status",
        "description": (
            "Report how this delegate is configured - model, endpoint, timeout, repository root, "
            "and whether a credential is present. Never reveals the key. Use it to confirm setup "
            "without spending a call."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def handle_tool_call(name: str, args: dict):
    root = repo_root()

    if name == "glm_status":
        key = _configured_key()
        # Length only. The value is never rendered, logged or returned by any path in this file.
        credential = ("present in environment ({0} characters)".format(len(key))
                      if key else "NOT SET")
        lines = [
            "Server:      {0} {1} (stdio, standard library only)".format(SERVER_NAME, SERVER_VERSION),
            "Model:       " + _setting("GLM_MODEL", DEFAULT_MODEL),
            "Endpoint:    " + _setting("GLM_BASE_URL", DEFAULT_BASE_URL),
            "Timeout:     {0}s".format(_setting("GLM_MCP_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS, int)),
            "Max tokens:  {0}".format(_setting("GLM_MCP_MAX_TOKENS", DEFAULT_MAX_TOKENS, int)),
            "Repo root:   {0}".format(root),
            "Credential:  " + credential,
            "",
            "Role:        delegated worker / reviewer. No write access to the repository.",
            "Scope:       development-agent tooling only. Not part of the AWKIT product and never packaged.",
            "Governance:  AGENTS.md, docs/ai/RULES.md, tools/agents/ routing and write lease.",
        ]
        if key is None:
            lines += [
                "",
                "To configure, in a Windows PowerShell terminal:",
                "    setx GLM_API_KEY \"YOUR_ZAI_API_KEY\"",
                "then open a new terminal and restart Claude Code.",
            ]
        return "\n".join(lines)

    max_tokens = args.get("max_tokens") or _setting("GLM_MCP_MAX_TOKENS", DEFAULT_MAX_TOKENS, int)
    max_tokens = max(512, min(int(max_tokens), 64000))

    if name == "glm_delegate":
        prompt, included, _ = build_delegation_prompt(root, args)
        header = (
            "GLM delegation - task {0}, mode {1}.\nFiles sent: {2}.\n"
            "This is a delegate's report. It is NOT completion evidence - validate independently "
            "before acting on it, and before any task or contract state changes.\n\n".format(
                args.get("task_id", "(unassigned)"),
                args.get("mode", "implementation"),
                len(included)))
        return header + call_glm(WORKER_CONSTRAINTS, prompt, max_tokens)

    if name == "glm_review":
        prompt, included, _ = build_review_prompt(root, args)
        header = (
            "GLM independent review - target {0}.\nFiles sent: {1}.\n"
            "Findings are claims to adjudicate against the evidence hierarchy, not defects.\n\n"
            .format(args.get("target", "(unspecified)"), len(included)))
        return header + call_glm(WORKER_CONSTRAINTS, prompt, max_tokens)

    raise RuntimeError("Unknown tool: " + str(name))


# ------------------------------------------------------------------------------ jsonrpc plumbing

def write_message(message: dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def respond(request_id, result) -> None:
    write_message({"jsonrpc": "2.0", "id": request_id, "result": result})


def respond_error(request_id, code, message) -> None:
    write_message({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}})


def main() -> int:
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = message.get("method")
        request_id = message.get("id")
        is_request = request_id is not None

        if method == "initialize":
            requested = (message.get("params") or {}).get("protocolVersion")
            version = (requested if requested in SUPPORTED_PROTOCOL_VERSIONS
                       else DEFAULT_PROTOCOL_VERSION)
            respond(request_id, {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            })

        elif method == "tools/list":
            respond(request_id, {"tools": TOOLS})

        elif method == "tools/call":
            params = message.get("params") or {}
            try:
                text = handle_tool_call(params.get("name", ""), params.get("arguments") or {})
                respond(request_id, {"content": [{"type": "text", "text": text}]})
            except Exception as error:  # surfaced as a tool error to the Manager, never a crash
                respond(request_id, {
                    "content": [{"type": "text", "text": "GLM delegation failed.\n\n" + str(error)}],
                    "isError": True,
                })

        elif method == "ping":
            respond(request_id, {})

        elif method in ("notifications/initialized", "notifications/cancelled"):
            continue

        elif is_request:
            respond_error(request_id, -32601, "Method not found: " + str(method))

    return 0


if __name__ == "__main__":
    sys.exit(main())
