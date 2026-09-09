#!/usr/bin/env python3
"""
Offline verifier for the glm-delegate MCP server's budget separation.

WHAT THIS PROVES
    That the three budgets in .claude/mcp/glm_delegate_server.py are genuinely separate concepts:
    a default response budget, a configurable maximum response ceiling, and a repository read
    budget measured in bytes and files. In particular it proves the old hard-coded 64000-token
    response cap is gone, that a caller may now ask for more than it, and that a single delegation
    may now assemble more than the old 240,000-byte total.

    It also proves the containment guarantees that budget survived: secret-bearing paths, paths
    outside the repository root, and build-output directories are still refused or skipped, and the
    truncation, omission and scope-too-wide notices still appear.

WHAT THIS DOES NOT PROVE
    Nothing here calls the GLM API. Two checks stub urllib at the HTTP boundary to inspect the
    serialized request this server would send; those are labelled REQUEST-LAYER and are evidence
    about the request, never about a response. Live delegation evidence comes from
    verify_glm_delegate_live.py, which really calls the provider.

NO NETWORK, NO CREDENTIAL, NO WRITES
    This verifier needs no GLM_API_KEY and makes no network connection. It writes only inside a
    temporary directory it creates and removes. It never modifies the repository.

RUN
    npm run verify:glm-delegate
"""

import importlib.util
import io
import json
import os
import py_compile
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# __pycache__ is NOT in this repository's .gitignore, so neither importing the server under test nor
# compiling it may leave bytecode beside it. Every child process gets the same setting below.
sys.dont_write_bytecode = True

HERE = Path(__file__).resolve().parent
SERVER_PATH = HERE / "glm_delegate_server.py"
REPO_ROOT = HERE.parent.parent

# The limits the previous implementation imposed. Every "this is now possible" check below is
# expressed against these, so the verifier keeps meaning what it says if the defaults move again.
OLD_HARD_OUTPUT_CAP = 64000
OLD_TOTAL_READ_BUDGET = 240_000

_RESULTS = []


def check(name, condition, detail=""):
    _RESULTS.append((bool(condition), name))
    status = "PASS" if condition else "FAIL"
    line = "  {0}  {1}".format(status, name)
    if detail and not condition:
        line += "\n        {0}".format(detail)
    elif detail:
        # A passing check still shows what it observed - that is what makes it evidence rather than
        # a green tick - but only the first line and only so much of it.
        summary = str(detail).splitlines()[0]
        line += "  [{0}]".format(summary if len(summary) <= 160 else summary[:157] + "...")
    print(line)
    return bool(condition)


def section(title):
    print("\n" + title)
    print("-" * len(title))


# --------------------------------------------------------------------------------- module import

def load_server():
    """Import the server under test by path, so no package layout or sys.path edit is needed."""
    spec = importlib.util.spec_from_file_location("glm_delegate_server_under_test", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Env:
    """Scoped environment overrides, restored on exit.

    Changes here are process-local: they never touch the developer's real environment and never
    read, print or alter GLM_API_KEY's real value outside this process.
    """

    def __init__(self, **values):
        self.values = values
        self.saved = {}

    def __enter__(self):
        for key, value in self.values.items():
            self.saved[key] = os.environ.get(key)
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = str(value)
        return self

    def __exit__(self, *_):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        return False


# ---------------------------------------------------------------------------------- output budget

def test_output_budget(glm):
    section("Output budget - the response ceiling is configurable and the 64000 cap is gone")

    cleared = dict(GLM_MCP_MAX_TOKENS=None, GLM_MCP_MAX_OUTPUT_TOKENS=None)

    with Env(**cleared):
        _, ceiling, effective = glm.resolve_output_budget(None)
        check("OB-1 no override resolves to the 16384 default response budget",
              effective == 16384, "effective={0}".format(effective))
        check("OB-1b the default maximum response ceiling is 131072",
              ceiling == 131072, "ceiling={0}".format(ceiling))

        for requested, expected in ((32000, 32000), (64000, 64000), (100000, 100000)):
            _, _, got = glm.resolve_output_budget(requested)
            check("OB-{0} max_tokens={1} resolves to {2}".format(
                {32000: 2, 64000: 3, 100000: 4}[requested], requested, expected),
                got == expected, "got={0}".format(got))

        _, _, got = glm.resolve_output_budget(100000)
        check("OB-4b max_tokens=100000 is NOT clamped to the old 64000 cap",
              got > OLD_HARD_OUTPUT_CAP, "got={0}".format(got))

        _, _, got = glm.resolve_output_budget(200000)
        check("OB-5 max_tokens=200000 clamps to the 131072 ceiling",
              got == 131072, "got={0}".format(got))

    with Env(GLM_MCP_MAX_TOKENS=None, GLM_MCP_MAX_OUTPUT_TOKENS="32768"):
        _, ceiling, got = glm.resolve_output_budget(64000)
        check("OB-6 a configured ceiling of 32768 clamps a requested 64000 down to 32768",
              got == 32768 and ceiling == 32768, "got={0} ceiling={1}".format(got, ceiling))

    section("Output budget - malformed configuration falls back safely")

    malformed = ["", "   ", "abc", "16k", "-1", "0", "1e5", "3.5", "${GLM_MCP_MAX_TOKENS}", "None"]
    default_ok = True
    ceiling_ok = True
    for raw in malformed:
        with Env(GLM_MCP_MAX_TOKENS=raw, GLM_MCP_MAX_OUTPUT_TOKENS=None):
            _, _, got = glm.resolve_output_budget(None)
            if got != 16384:
                default_ok = False
                print("        GLM_MCP_MAX_TOKENS={0!r} gave {1}".format(raw, got))
        with Env(GLM_MCP_MAX_TOKENS=None, GLM_MCP_MAX_OUTPUT_TOKENS=raw):
            _, ceiling, _ = glm.resolve_output_budget(None)
            if ceiling != 131072:
                ceiling_ok = False
                print("        GLM_MCP_MAX_OUTPUT_TOKENS={0!r} gave {1}".format(raw, ceiling))
    check("OB-7 all {0} malformed GLM_MCP_MAX_TOKENS values fall back to 16384".format(
        len(malformed)), default_ok)
    check("OB-7b all {0} malformed GLM_MCP_MAX_OUTPUT_TOKENS values fall back to 131072".format(
        len(malformed)), ceiling_ok)

    section("Output budget - no resolved value can produce an invalid request")

    with Env(**cleared):
        floor_ok = True
        for requested in (1, 2, 511, -10, -100000):
            _, _, got = glm.resolve_output_budget(requested)
            if got < glm.MIN_OUTPUT_TOKENS:
                floor_ok = False
                print("        requested={0} gave {1}".format(requested, got))
        check("OB-8 requests below the {0}-token floor are raised to it".format(
            glm.MIN_OUTPUT_TOKENS), floor_ok)

        _, _, zero = glm.resolve_output_budget(0)
        check("OB-8b max_tokens=0 means 'unspecified', not a zero budget",
              zero == 16384, "got={0}".format(zero))

        for bad in ("abc", None, "", [], {}):
            _, _, got = glm.resolve_output_budget(bad)
            if got != 16384:
                check("OB-8c non-numeric max_tokens={0!r} falls back to the default".format(bad),
                      False, "got={0}".format(got))
                break
        else:
            check("OB-8c non-numeric max_tokens values fall back to the default", True)

    with Env(GLM_MCP_MAX_TOKENS=None, GLM_MCP_MAX_OUTPUT_TOKENS="10"):
        _, _, got = glm.resolve_output_budget(None)
        check("OB-8d a configured ceiling below the floor cannot yield an invalid budget",
              got >= glm.MIN_OUTPUT_TOKENS, "got={0}".format(got))

    section("Output budget - the 64000 constant is absent from the source")

    source = SERVER_PATH.read_text(encoding="utf-8")
    check("OB-9 the literal 64000 appears nowhere in glm_delegate_server.py",
          "64000" not in source and "64_000" not in source)
    check("OB-9b the three budget environment names are all documented in the source",
          all(name in source for name in (
              "GLM_MCP_MAX_TOKENS", "GLM_MCP_MAX_OUTPUT_TOKENS",
              "GLM_MCP_MAX_FILE_BYTES", "GLM_MCP_MAX_TOTAL_BYTES", "GLM_MCP_MAX_FILES")))


# ------------------------------------------------------------------------------------ read budget

def make_fixture_root():
    """A throwaway repository-shaped tree to read from. Never the real repository."""
    root = Path(tempfile.mkdtemp(prefix="glm-verify-")).resolve()
    (root / "AGENTS.md").write_text("# fixture\n", encoding="utf-8")
    (root / "package.json").write_text("{}\n", encoding="utf-8")
    return root


def write_file(root, relative, size_bytes=None, text=None):
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if text is None:
        # Deterministic filler that stays 1 byte per character in UTF-8.
        marker = "// {0}\n".format(relative)
        body = "x" * max(0, size_bytes - len(marker.encode("utf-8")))
        text = marker + body
    path.write_text(text, encoding="utf-8")
    return path


def test_read_budget(glm):
    section("Read budget - defaults are the raised input budget, not the old one")

    with Env(GLM_MCP_MAX_FILE_BYTES=None, GLM_MCP_MAX_TOTAL_BYTES=None, GLM_MCP_MAX_FILES=None):
        budget = glm.resolve_read_budget()
        check("RB-0 default per-file budget is 200000 bytes",
              budget.max_file_bytes == 200_000, "got={0}".format(budget.max_file_bytes))
        check("RB-0b default total read budget is 1500000 bytes",
              budget.max_total_bytes == 1_500_000, "got={0}".format(budget.max_total_bytes))
        check("RB-0c default file-count budget is 120 files",
              budget.max_files == 120, "got={0}".format(budget.max_files))
        check("RB-0d the total read budget now exceeds the old 240000-byte ceiling",
              budget.max_total_bytes > OLD_TOTAL_READ_BUDGET)

    malformed_ok = True
    for raw in ("", "abc", "-1", "0", "${X}", "1.5"):
        with Env(GLM_MCP_MAX_FILE_BYTES=raw, GLM_MCP_MAX_TOTAL_BYTES=raw, GLM_MCP_MAX_FILES=raw):
            budget = glm.resolve_read_budget()
            if (budget.max_file_bytes, budget.max_total_bytes, budget.max_files) != (
                    200_000, 1_500_000, 120):
                malformed_ok = False
                print("        {0!r} gave {1}/{2}/{3}".format(
                    raw, budget.max_file_bytes, budget.max_total_bytes, budget.max_files))
    check("RB-0e malformed read-budget values fall back to the documented defaults", malformed_ok)

    root = make_fixture_root()
    try:
        section("Read budget - whole files, truncation, and the raised total")

        write_file(root, "src/small.ts", text="// small\nexport const a = 1;\n")
        default_budget = glm.ReadBudget(200_000, 1_500_000, 120)

        text, included, notes, total = glm.read_scope_text(root, ["src/small.ts"], default_budget)
        check("RB-1 a file below the per-file budget is sent complete",
              "export const a = 1;" in text and included == ["src/small.ts"]
              and not any(n.startswith("TRUNCATED") for n in notes),
              "included={0} notes={1}".format(included, notes))
        check("RB-1b source bytes are reported and are non-zero",
              total > 0 and total == len(text.encode("utf-8")) - len(
                  "----- FILE: src/small.ts -----\n\n----- END: src/small.ts -----".encode("utf-8")),
              "total={0}".format(total))

        write_file(root, "src/huge.ts", size_bytes=300_000)
        small_file_budget = glm.ReadBudget(50_000, 1_500_000, 120)
        text, included, notes, total = glm.read_scope_text(root, ["src/huge.ts"], small_file_budget)
        check("RB-2 a file above the per-file budget is truncated with an explicit note",
              "TRUNCATED: src/huge.ts" in notes
              and "[TRUNCATED at 50000 bytes - this file is incomplete]" in text,
              "notes={0}".format(notes))
        check("RB-2b the truncated file is still counted as included",
              included == ["src/huge.ts"], "included={0}".format(included))
        check("RB-2c a truncated file's payload respects the per-file budget",
              total < 51_000, "total={0}".format(total))

        section("Read budget - a delegation may now exceed the old 240000-byte total")

        big = root / "big"
        for index in range(5):
            write_file(big, "part{0}.ts".format(index), size_bytes=70_000)
        text, included, notes, total = glm.read_scope_text(root, ["big"], default_budget)
        check("RB-3 all five 70000-byte files are included",
              len(included) == 5, "included={0}".format(included))
        check("RB-3b the assembled source exceeds the old 240000-byte total budget",
              total > OLD_TOTAL_READ_BUDGET, "total={0}".format(total))
        check("RB-3c no omission note was emitted at the raised budget",
              not any(n.startswith("OMITTED") for n in notes), "notes={0}".format(notes))
        check("RB-10 the prompt section itself carries more than 240000 bytes",
              len(text.encode("utf-8")) > OLD_TOTAL_READ_BUDGET,
              "bytes={0}".format(len(text.encode("utf-8"))))

        section("Read budget - the configured limits still stop the read")

        capped = glm.ReadBudget(200_000, 150_000, 120)
        text, included, notes, total = glm.read_scope_text(root, ["big"], capped)
        omitted = [n for n in notes if n.startswith("OMITTED")]
        check("RB-4 the total read budget stops the read at the configured limit",
              total <= 150_000, "total={0}".format(total))
        check("RB-4b omitted files are named in the notes",
              len(omitted) >= 1 and "150000" in omitted[0], "omitted={0}".format(omitted))
        check("RB-4c omitted files are NOT reported as included",
              len(included) == 2 and all(
                  not any(name in note for note in omitted) for name in included),
              "included={0} omitted={1}".format(included, omitted))

        few = glm.ReadBudget(200_000, 1_500_000, 3)
        text, included, notes, total = glm.read_scope_text(root, ["big"], few)
        wide = [n for n in notes if n.startswith("SCOPE TOO WIDE")]
        check("RB-5 the configured file-count budget is respected",
              len(included) == 3, "included={0}".format(included))
        check("RB-5b exceeding the file-count budget emits a scope-too-wide note",
              len(wide) == 1 and "5 files matched" in wide[0], "notes={0}".format(notes))

        section("Read budget - containment and filtering survived the raise")

        write_file(root, "src/credential-map.ts", text="const k = 1;\n")
        write_file(root, "app/session-profiles/store.ts", text="const k = 2;\n")
        write_file(root, "keys/issuer-keys/private.ts", text="const k = 3;\n")
        _, included, notes, _ = glm.read_scope_text(
            root, ["src/credential-map.ts", "app", "keys"], default_budget)
        check("RB-6 a directly named secret-bearing file is refused with a note",
              "SKIPPED (not a readable text type, or secret-bearing path): src/credential-map.ts"
              in notes, "notes={0}".format(notes))
        check("RB-6b secret-bearing paths are excluded from a directory walk too",
              not any("session-profiles" in name or "issuer-keys" in name for name in included),
              "included={0}".format(included))

        _, _, notes, _ = glm.read_scope_text(root, ["../outside.ts"], default_budget)
        check("RB-7 a path outside the repository root is refused",
              any(n.startswith("REFUSED (outside repository root)") for n in notes),
              "notes={0}".format(notes))

        absolute_outside = str(Path(tempfile.gettempdir()).resolve() / "definitely-outside.ts")
        _, _, notes, _ = glm.read_scope_text(root, [absolute_outside], default_budget)
        check("RB-7b an absolute path outside the repository root is refused",
              any(n.startswith("REFUSED (outside repository root)") for n in notes),
              "notes={0}".format(notes))

        for skipped in ("node_modules", "dist", "graphify-out", "coverage", "build", ".git"):
            write_file(root, "skipme/{0}/mod.ts".format(skipped), text="const s = 1;\n")
        write_file(root, "skipme/kept.ts", text="const s = 3;\n")
        _, included, _, _ = glm.read_scope_text(root, ["skipme"], default_budget)
        check("RB-8 single-segment build-output directories are skipped at any depth",
              included == ["skipme/kept.ts"], "included={0}".format(included))

        # "resources/browsers" is a two-segment skip entry and is anchored at the repository root on
        # purpose - it names AWKIT's bundled Chromium, not every directory pair with those names.
        write_file(root, "resources/browsers/list.ts", text="const s = 2;\n")
        write_file(root, "resources/kept.ts", text="const s = 4;\n")
        _, included, _, _ = glm.read_scope_text(root, ["resources"], default_budget)
        check("RB-8b the root-anchored resources/browsers skip still applies",
              included == ["resources/kept.ts"], "included={0}".format(included))

        section("Read budget - configuration is consumed, not re-read inside the loop")

        with Env(GLM_MCP_MAX_TOTAL_BYTES="9999999", GLM_MCP_MAX_FILES="999"):
            _, included, _, total = glm.read_scope_text(root, ["big"], capped)
            check("RB-11 read_scope_text obeys the budget it was passed, not the environment",
                  total <= 150_000 and len(included) == 2,
                  "total={0} included={1}".format(total, included))
        with Env(GLM_MCP_MAX_TOTAL_BYTES="1000", GLM_MCP_MAX_FILES="1"):
            _, included, _, total = glm.read_scope_text(root, ["big"], default_budget)
            check("RB-11b a restrictive environment cannot narrow an already-resolved budget",
                  len(included) == 5 and total > OLD_TOTAL_READ_BUDGET,
                  "total={0} included={1}".format(total, included))

        section("Failure paths - predictable diagnostics, never a crash")

        _, included, notes, _ = glm.read_scope_text(
            root, ["src/does-not-exist.ts", "src/small.ts"], default_budget)
        check("FP-1 a missing path is reported as NOT FOUND and does not abort the read",
              "NOT FOUND: src/does-not-exist.ts" in notes and included == ["src/small.ts"],
              "notes={0} included={1}".format(notes, included))

        _, included, notes, _ = glm.read_scope_text(root, ["", "   "], default_budget)
        check("FP-1b blank scope entries are ignored rather than resolving to the repository root",
              included == [] and notes == [], "included={0} notes={1}".format(included, notes))

        _, included, notes, _ = glm.read_scope_text(root, [None], default_budget)
        check("FP-1c a null scope entry is reported, never expanded to the whole repository",
              included == [] and notes == ["NOT FOUND: None"],
              "included={0} notes={1}".format(included, notes))

    finally:
        shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------------- request-layer inspection

class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
        return False


def _stub_urlopen(glm, captured, body):
    def fake(request, timeout=None):
        captured.append({"data": request.data, "headers": dict(request.header_items()),
                         "url": request.full_url, "timeout": timeout})
        return _FakeResponse(json.dumps(body).encode("utf-8"))
    return fake


def test_request_layer(glm):
    section("Request layer - the serialized payload carries the effective budget")

    canned = {
        "model": "glm-5.3",
        "content": [{"type": "text", "text": "stubbed body"}],
        "usage": {"input_tokens": 4321, "output_tokens": 99},
        "stop_reason": "end_turn",
    }

    root = make_fixture_root()
    write_file(root, "src/small.ts", text="// small\nexport const a = 1;\n")
    original = glm.urllib.request.urlopen
    try:
        with Env(GLM_API_KEY="test-only-not-a-real-key", GLM_MCP_REPO_ROOT=str(root),
                 GLM_MCP_MAX_TOKENS=None, GLM_MCP_MAX_OUTPUT_TOKENS=None):
            captured = []
            glm.urllib.request.urlopen = _stub_urlopen(glm, captured, canned)

            out = glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-ceiling",
                "objective": "ceiling proof",
                "read_scope": ["src/small.ts"],
                "max_tokens": 100000,
            })
            payload = json.loads(captured[0]["data"].decode("utf-8"))
            check("CEIL-1 the serialized request contains \"max_tokens\": 100000",
                  payload.get("max_tokens") == 100000,
                  "payload max_tokens={0}".format(payload.get("max_tokens")))
            check("CEIL-1b the serialized budget exceeds the old 64000 hard cap",
                  payload.get("max_tokens") > OLD_HARD_OUTPUT_CAP)
            check("CEIL-1c the header reports the requested and effective budgets separately",
                  "Requested output budget: 100000 tokens." in out
                  and "Effective output budget: 100000 tokens (configured maximum 131072)." in out,
                  out.splitlines()[:6])
            check("CEIL-1d the credential is never echoed into the returned text",
                  "test-only-not-a-real-key" not in out)
            check("CEIL-1e provider usage is reported verbatim, not estimated from bytes",
                  "Input tokens reported by provider: 4321" in out
                  and "Output tokens reported by provider: 99" in out
                  and "Tokens: in=4321 out=99" in out)
            check("CEIL-1f the stop reason is reported",
                  "Stop reason: end_turn" in out)
            check("CEIL-1g locally measured source bytes are reported as bytes, not tokens",
                  "Source bytes sent: " in out and "Files sent: 1." in out)

            captured.clear()
            out = glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-clamp", "objective": "clamp proof",
                "read_scope": ["src/small.ts"], "max_tokens": 200000,
            })
            payload = json.loads(captured[0]["data"].decode("utf-8"))
            check("FP-4 a request above the configured maximum is clamped in the payload",
                  payload.get("max_tokens") == 131072,
                  "payload max_tokens={0}".format(payload.get("max_tokens")))
            check("FP-4b the clamp is disclosed in the report header",
                  "the requested budget exceeded the configured maximum and was clamped" in out)

            captured.clear()
            out = glm.handle_tool_call("glm_review", {
                "target": "verify", "read_scope": ["src/small.ts"],
            })
            payload = json.loads(captured[0]["data"].decode("utf-8"))
            check("RV-1 glm_review defaults to the 16384 response budget",
                  payload.get("max_tokens") == 16384,
                  "payload max_tokens={0}".format(payload.get("max_tokens")))
            check("RV-1b glm_review still requests the CRITICAL/HIGH/MEDIUM/LOW/OBSERVATION shape",
                  all(h in payload["messages"][0]["content"]
                      for h in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "OBSERVATION")))
            check("RV-1c glm_review sends the repository slice it was given",
                  "export const a = 1;" in payload["messages"][0]["content"])

        with Env(GLM_API_KEY="test-only-not-a-real-key", GLM_MCP_REPO_ROOT=str(root),
                 GLM_MCP_MAX_OUTPUT_TOKENS="32768"):
            captured = []
            glm.urllib.request.urlopen = _stub_urlopen(glm, captured, canned)
            glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-env-ceiling", "objective": "env ceiling",
                "read_scope": ["src/small.ts"], "max_tokens": 64000,
            })
            payload = json.loads(captured[0]["data"].decode("utf-8"))
            check("CEIL-2 a configured ceiling of 32768 is what actually reaches the payload",
                  payload.get("max_tokens") == 32768,
                  "payload max_tokens={0}".format(payload.get("max_tokens")))

        with Env(GLM_API_KEY="test-only-not-a-real-key", GLM_MCP_REPO_ROOT=str(root)):
            truncated = dict(canned, stop_reason="max_tokens")
            glm.urllib.request.urlopen = _stub_urlopen(glm, [], truncated)
            out = glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-truncation", "objective": "truncation warning",
                "read_scope": ["src/small.ts"],
            })
            check("TR-1 a max_tokens stop reason still raises the truncation warning",
                  "WARNING: the response hit max_tokens and is TRUNCATED" in out)
            check("TR-1b the warning explains that reasoning shares the response budget",
                  "reasoning is charged to the same budget" in out,
                  "a bare 'it was truncated' does not tell the caller where the budget went")

            # This one guards a retraction. An earlier revision of the warning told the caller to
            # "narrow the read scope, or raise max_tokens". Four live delegations of 288KB-432KB at
            # 16384 then measured the opposite: all four truncated, and the packet NARROWED from
            # 432,572 to 287,972 bytes returned the shortest report of the four (1,576 characters
            # against 29,414) while burning the most budget on reasoning. Prescriptive advice that
            # the repository's own measurements contradict must not come back.
            check("TR-1c the warning prescribes no remedy that measurement has refuted",
                  "narrow the read scope" not in out.lower(),
                  "narrowing was measured to make the report shorter, not longer")
            check("TR-1d the warning instead reports what was measured",
                  "no remedy for this is established by measurement" in out.lower(),
                  "the caller needs to know the failure is not one they can reliably re-scope away")

        # A live run measured 16384 output tokens against a 2,542-character report and, separately,
        # 22 input tokens for a 432,572-byte packet. Both readings were correct and both were
        # unreadable, because the footer quoted neither the discarded reasoning nor the cache. These
        # are stubbed so the disclosure is proven deterministically, without spending a call.
        section("Footer disclosure - unrendered reasoning and prompt-cache accounting")

        with Env(GLM_API_KEY="test-only-not-a-real-key", GLM_MCP_REPO_ROOT=str(root)):
            reasoning = dict(
                canned,
                content=[{"type": "thinking", "thinking": "x" * 900},
                         {"type": "text", "text": "the visible report"}],
                usage={"input_tokens": 41, "output_tokens": 16384,
                       "cache_read_input_tokens": 99777, "cache_creation_input_tokens": 512},
                stop_reason="max_tokens")
            glm.urllib.request.urlopen = _stub_urlopen(glm, [], reasoning)
            out = glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-disclosure", "objective": "footer disclosure",
                "read_scope": ["src/small.ts"],
            })
            check("DISC-1 the unrendered reasoning is still not rendered",
                  "x" * 900 not in out,
                  "a compact report is the point; the reasoning must stay dropped")
            check("DISC-2 but the footer names the block type and how much was discarded",
                  "Non-rendered response blocks: thinking (900 characters)" in out,
                  "otherwise a full output_tokens count beside a short report is inexplicable")
            check("DISC-3 the cached portion of the input is quoted from the provider",
                  "Cached input tokens read (provider): 99777" in out
                  and "Cached input tokens written (provider): 512" in out,
                  "input_tokens=41 alone would read as 'nothing was sent'")
            check("DISC-4 the uncached provider counts are unchanged beside them",
                  "Input tokens reported by provider: 41" in out
                  and "Tokens: in=41 out=16384" in out)

            # The complement, and what stops DISC-3 from being satisfied by a hardcoded line: a
            # provider response without cache keys must not grow invented ones.
            glm.urllib.request.urlopen = _stub_urlopen(glm, [], canned)
            out = glm.handle_tool_call("glm_delegate", {
                "task_id": "verify-no-cache-keys", "objective": "absent cache fields",
                "read_scope": ["src/small.ts"],
            })
            check("DISC-5 cache lines are absent when the provider reports no cache fields",
                  "Cached input tokens" not in out,
                  "only fields the API actually returned may be displayed")
            check("DISC-6 an all-text response reports no discarded blocks",
                  "Non-rendered response blocks" not in out)

        section("Failure paths - missing credential and unknown tool")

        with Env(GLM_API_KEY=None, GLM_MCP_REPO_ROOT=str(root)):
            glm.urllib.request.urlopen = _stub_urlopen(glm, [], canned)
            try:
                glm.handle_tool_call("glm_delegate", {
                    "task_id": "x", "objective": "y", "read_scope": ["src/small.ts"]})
                check("FP-5 a missing credential raises a clear error", False, "no error raised")
            except RuntimeError as error:
                check("FP-5 a missing credential raises a clear error naming GLM_API_KEY",
                      "GLM_API_KEY is not set" in str(error))

        try:
            glm.handle_tool_call("glm_nonexistent", {})
            check("FP-6 an unknown tool name raises rather than silently succeeding", False)
        except RuntimeError as error:
            check("FP-6 an unknown tool name raises a named error",
                  "Unknown tool" in str(error), str(error))

    finally:
        glm.urllib.request.urlopen = original
        shutil.rmtree(root, ignore_errors=True)


# ------------------------------------------------------------------------------- mcp stdio server

class McpClient:
    """Speaks JSON-RPC over stdio to a freshly spawned server, the way an MCP client does."""

    def __init__(self, env_overrides=None):
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        for key, value in (env_overrides or {}).items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = str(value)

        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER_PATH)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            cwd=str(REPO_ROOT), env=env, text=True, encoding="utf-8", bufsize=1)
        self.lines = queue.Queue()
        self.reader = threading.Thread(target=self._pump, daemon=True)
        self.reader.start()

    def _pump(self):
        for line in self.proc.stdout:
            self.lines.put(line)
        self.lines.put(None)

    def request(self, request_id, method, params=None, timeout=60):
        message = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            message["params"] = params
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()
        raw = self.lines.get(timeout=timeout)
        if raw is None:
            raise RuntimeError("server closed stdout before answering " + method)
        return json.loads(raw)

    def notify(self, method, params=None):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def test_mcp_protocol():
    section("MCP protocol - a freshly spawned server over stdio")

    client = McpClient({
        "GLM_MCP_MAX_TOKENS": None,
        "GLM_MCP_MAX_OUTPUT_TOKENS": None,
        "GLM_MCP_MAX_FILE_BYTES": None,
        "GLM_MCP_MAX_TOTAL_BYTES": None,
        "GLM_MCP_MAX_FILES": None,
    })
    try:
        reply = client.request(1, "initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "verify-glm-delegate", "version": "1.0.0"},
        })
        result = reply.get("result") or {}
        check("MCP-1 initialize negotiates the requested protocol version",
              result.get("protocolVersion") == "2025-06-18", json.dumps(result))
        check("MCP-1b initialize reports the server identity",
              (result.get("serverInfo") or {}).get("name") == "glm-delegate",
              json.dumps(result.get("serverInfo")))

        client.notify("notifications/initialized")

        reply = client.request(2, "tools/list")
        names = [tool["name"] for tool in (reply.get("result") or {}).get("tools", [])]
        check("MCP-2 all three tools stay exposed",
              sorted(names) == ["glm_delegate", "glm_review", "glm_status"], names)

        schema = next(t for t in reply["result"]["tools"] if t["name"] == "glm_delegate")
        description = schema["inputSchema"]["properties"]["max_tokens"]["description"]
        check("MCP-2b the max_tokens schema names both output settings",
              "GLM_MCP_MAX_TOKENS" in description and "GLM_MCP_MAX_OUTPUT_TOKENS" in description,
              description)

        reply = client.request(3, "tools/call", {"name": "glm_status", "arguments": {}})
        status = (reply.get("result") or {}).get("content", [{}])[0].get("text", "")
        check("MCP-3 glm_status names the default response budget distinctly",
              "Default output tokens:   16384" in status, status)
        check("MCP-3b glm_status names the maximum response ceiling distinctly",
              "Maximum output tokens:   131072" in status, status)
        check("MCP-3c glm_status reports the per-file read budget",
              "Maximum file bytes:      200000" in status, status)
        check("MCP-3d glm_status reports the total read budget",
              "Maximum total read bytes:1500000" in status, status)
        check("MCP-3e glm_status reports the file-count read budget",
              "Maximum files:           120" in status, status)
        check("MCP-3f glm_status no longer labels anything merely 'Max tokens'",
              "Max tokens:" not in status, status)
        check("MCP-3g glm_status still reports model, endpoint, timeout, repo root and credential",
              all(label in status for label in (
                  "Model:", "Endpoint:", "Timeout:", "Repo root:", "Credential:")), status)

        key = os.environ.get("GLM_API_KEY", "").strip()
        if key and not key.startswith("${"):
            check("SEC-5 glm_status reports credential presence without revealing the value",
                  key not in status and "present in environment" in status)
        else:
            check("SEC-5 glm_status reports a missing credential plainly",
                  "NOT SET" in status, status)

        reply = client.request(4, "tools/call", {"name": "glm_bogus", "arguments": {}})
        result = reply.get("result") or {}
        check("MCP-4 an unknown tool returns an MCP tool error rather than crashing the server",
              result.get("isError") is True and "Unknown tool" in result["content"][0]["text"],
              json.dumps(result)[:200])

        reply = client.request(5, "ping")
        check("MCP-4b the server is still alive after a tool error", "result" in reply)

        reply = client.request(6, "nonexistent/method")
        check("MCP-5 an unknown JSON-RPC method returns -32601",
              (reply.get("error") or {}).get("code") == -32601, json.dumps(reply))
    finally:
        client.close()

    section("MCP protocol - environment overrides reach a spawned server")

    client = McpClient({
        "GLM_MCP_MAX_TOKENS": "8192",
        "GLM_MCP_MAX_OUTPUT_TOKENS": "32768",
        "GLM_MCP_MAX_FILE_BYTES": "12345",
        "GLM_MCP_MAX_TOTAL_BYTES": "678901",
        "GLM_MCP_MAX_FILES": "7",
    })
    try:
        client.request(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                         "clientInfo": {"name": "v", "version": "1"}})
        reply = client.request(2, "tools/call", {"name": "glm_status", "arguments": {}})
        status = (reply.get("result") or {}).get("content", [{}])[0].get("text", "")
        check("MCP-6 configured overrides are what glm_status reports",
              all(fragment in status for fragment in (
                  "Default output tokens:   8192",
                  "Maximum output tokens:   32768",
                  "Maximum file bytes:      12345",
                  "Maximum total read bytes:678901",
                  "Maximum files:           7")), status)
    finally:
        client.close()


# ---------------------------------------------------------------------------- static and security

def test_static_and_security(glm):
    section("Static validation")

    # The byte-compile the contract asks for, with the output redirected to a temporary file so the
    # check leaves no __pycache__ directory in a repository that does not ignore one.
    #
    # The live verifier is compiled here too, and deliberately so: it is the only other file in this
    # change, it costs real money to run, and it must not be discovered to have a syntax error
    # halfway through a paid leg. This is a syntax gate only - it proves nothing about behaviour.
    for tag, path in (("PC-1", SERVER_PATH), ("PC-2", HERE / "verify_glm_delegate_live.py")):
        label = "{0} {1} byte-compiles (py_compile, doraise)".format(tag, path.name)
        handle, cfile = tempfile.mkstemp(suffix=".pyc")
        os.close(handle)
        try:
            py_compile.compile(str(path), cfile=cfile, doraise=True)
            check(label, True)
        except py_compile.PyCompileError as error:
            check(label, False, str(error))
        finally:
            try:
                os.remove(cfile)
            except OSError:
                pass

    source = SERVER_PATH.read_text(encoding="utf-8")

    section("Security - the read-only, no-dependency guarantees are intact")

    expected_hints = (
        "credential", "secret", ".env", "id_rsa", ".pem", ".pfx", ".p12", ".key",
        "storage-state", "auth-state", "session-profiles", "issuer-keys",
        "settings.local.json",
    )
    check("SEC-1 SECRET_NAME_HINTS is unchanged",
          glm.SECRET_NAME_HINTS == expected_hints, str(glm.SECRET_NAME_HINTS))

    expected_skips = {
        "node_modules", ".git", "dist", "out", "release", "build",
        "graphify-out", "coverage", "playwright-report", "test-results",
        ".vs", ".idea", ".turbo", "resources/browsers",
    }
    check("SEC-2 SKIP_DIRECTORIES is unchanged",
          glm.SKIP_DIRECTORIES == expected_skips, str(glm.SKIP_DIRECTORIES))

    forbidden = ("subprocess", "os.system", "os.popen", "shutil", "write_text", "write_bytes",
                 "os.remove", "os.rmdir", "unlink(", "mkdir(", "rmtree", "eval(", "exec(")
    found = [token for token in forbidden if token in source]
    check("SEC-3 the server has no write, delete or execution capability",
          not found, "found {0}".format(found))

    imports = sorted({
        line.split()[1].split(".")[0]
        for line in source.splitlines()
        if line.startswith("import ") or line.startswith("from ")
    })
    allowed = {"json", "os", "sys", "textwrap", "urllib", "pathlib"}
    check("SEC-4 imports are Python standard library only, with no new dependency",
          set(imports) <= allowed, "imports={0}".format(imports))

    check("SEC-6 the repository-root containment check still every-segment matches secrets",
          "relative_to(root).as_posix().lower()" in source)


# ------------------------------------------------------------------------------------------ main

def main():
    print("verify:glm-delegate - offline budget, containment and protocol checks")
    print("server: {0}".format(SERVER_PATH))

    glm = load_server()

    test_output_budget(glm)
    test_read_budget(glm)
    test_request_layer(glm)
    test_static_and_security(glm)
    test_mcp_protocol()

    passed = sum(1 for ok, _ in _RESULTS if ok)
    failed = [name for ok, name in _RESULTS if not ok]

    print("\n" + "=" * 72)
    print("verify:glm-delegate  {0} PASS / {1} FAIL  ({2} checks)".format(
        passed, len(failed), len(_RESULTS)))
    if failed:
        print("\nFAILED:")
        for name in failed:
            print("  - " + name)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
