"""AWKIT DOM-intelligence host (L11, awkit-djnl.19): parser-only Scrapling behind a finite protocol.

Owned and spawned by the Electron main process (src/runner/domIntelligence/ScraplingDomIntelligenceProvider.ts).
One JSON object per line on stdin, one per line on stdout. It only ever PARSES sanitized HTML that AWKIT
captured in the browser and hands it; it never navigates, fetches, launches a browser, writes a file or runs
code it was sent.

Defence in depth, in this order:
  1. An audit hook, installed before anything else is imported, refuses network, process creation,
     FFI, SQLite connections, file writes, deletes, renames and directory changes, environment changes and
     the import of fetcher, spider, engine, AI, shell, browser and network modules. Hooks cannot be removed.
  2. The shipped runtime has no socket, SSL, ctypes or asyncio extension modules at all, and Scrapling's
     fetchers/spiders/engines/ai/shell/cli code and the `tld` package are stripped from site-packages.
  3. `hello` proves 1 and 2 at run time: it tries `import socket` and `import playwright` and reports
     network/browser access only as their actual outcome; the client refuses a host that reports either.
  4. Operations are a closed set with a fixed key set each; anything else is refused. Input and output are
     size-bounded; an oversized or unparseable line ends the process (the client never sends one).
  5. stdin EOF ends the process, so it can never outlive its owner.
"""

import sys

PROTOCOL_VERSION = 1
EXPECTED_SCRAPLING = "0.4.15"
MAX_REQUEST_BYTES = 3 * 1024 * 1024
MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_BYTES = 512 * 1024
MAX_CANDIDATES = 20

FORBIDDEN_MODULE_PREFIXES = (
    "socket",
    "_socket",
    "ssl",
    "_ssl",
    "select",
    "selectors",
    "asyncio",
    "subprocess",
    "multiprocessing",
    "ctypes",
    "_ctypes",
    "http.client",
    "urllib.request",
    "ftplib",
    "smtplib",
    "imaplib",
    "poplib",
    "webbrowser",
    "playwright",
    "patchright",
    "curl_cffi",
    "browserforge",
    "camoufox",
    "mcp",
    "markdownify",
    "tld",
    "scrapling.fetchers",
    "scrapling.spiders",
    "scrapling.engines",
    "scrapling.core.ai",
    "scrapling.core.shell",
    "scrapling.cli",
    "scrapling.integrations",
)

BLOCKED_EVENT_PREFIXES = (
    "socket.",
    "subprocess.",
    "os.system",
    "os.exec",
    "os.posix_spawn",
    "os.spawn",
    "os.startfile",
    "os.fork",
    "os.kill",
    "os.putenv",
    "os.unsetenv",
    "os.remove",
    "os.rmdir",
    "os.rename",
    "os.mkdir",
    "os.chmod",
    "os.chown",
    "os.truncate",
    "os.symlink",
    "os.link",
    "os.utime",
    "os.chdir",
    "shutil.",
    "tempfile.",
    "_winapi.",
    "winreg.",
    "ctypes.",
    "sqlite3.connect",
    "urllib.Request",
    "webbrowser.open",
    "ftplib.",
    "smtplib.",
    "imaplib.",
    "poplib.",
    "http.client.",
    "mmap.",
)

# os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND on Windows and POSIX (os is not imported
# yet; these values are the platform constants CPython exposes).
_WRITE_FLAGS = 0x0001 | 0x0002 | 0x0100 | 0x0200 | 0x0008 if sys.platform == "win32" else 0x0001 | 0x0002 | 0x0040 | 0x0200 | 0x0400


def _forbidden_module(name):
    return any(name == prefix or name.startswith(prefix + ".") for prefix in FORBIDDEN_MODULE_PREFIXES)


def _audit(event, args):
    if event == "import":
        if args and isinstance(args[0], str) and _forbidden_module(args[0]):
            raise ImportError("blocked by the AWKIT DOM-intelligence sandbox: " + args[0])
        return
    if event == "open":
        mode = args[1] if len(args) > 1 else None
        flags = args[2] if len(args) > 2 else 0
        if isinstance(mode, str):
            if any(char in mode for char in "wax+"):
                raise PermissionError("blocked by the AWKIT DOM-intelligence sandbox: write")
        elif isinstance(flags, int) and flags & _WRITE_FLAGS:
            raise PermissionError("blocked by the AWKIT DOM-intelligence sandbox: write")
        return
    if event == "sys.addaudithook":
        raise RuntimeError("blocked by the AWKIT DOM-intelligence sandbox: audit hook")
    for prefix in BLOCKED_EVENT_PREFIXES:
        if event.startswith(prefix):
            raise RuntimeError("blocked by the AWKIT DOM-intelligence sandbox: " + event)


sys.addaudithook(_audit)

import json  # noqa: E402
import logging  # noqa: E402
import time  # noqa: E402

STARTED = time.perf_counter()
logging.getLogger("scrapling").setLevel(logging.CRITICAL)

# w3lib.url (imported by Scrapling's parser types) does `from urllib.request import pathname2url` at module
# level, and urllib.request would pull in http.client and socket. The parser never builds a file URI, so
# the host pre-seeds a stub that carries only the pure path helper: the network stack is never imported,
# and the shipped runtime does not need to contain it at all.
import types as _types  # noqa: E402

_request_stub = _types.ModuleType("urllib.request")
_request_stub.__doc__ = "AWKIT DOM-intelligence stub: pathname2url only. No network in this host."
if sys.platform == "win32":
    from nturl2path import pathname2url as _pathname2url  # noqa: E402
else:  # pragma: no cover - the shipped host is Windows-only
    from urllib.parse import quote as _pathname2url  # noqa: E402
_request_stub.pathname2url = _pathname2url
sys.modules["urllib.request"] = _request_stub

import lxml  # noqa: E402
import scrapling  # noqa: E402
from scrapling.core.utils import _StorageTools  # noqa: E402
from scrapling.parser import Selector  # noqa: E402

_SCORER = getattr(Selector, "_Selector__calculate_similarity_score", None)
REQUESTS = 0


def _refused(name):
    try:
        __import__(name)
    except BaseException:
        return True
    return False


def _loaded_forbidden():
    # The one exemption is the host's own pathname2url-only stub, matched by identity: a real
    # urllib.request (or anything else under a forbidden name) is still reported.
    return sorted(
        name
        for name, module in list(sys.modules.items())
        if _forbidden_module(name) and not (name == "urllib.request" and module is _request_stub)
    )


class ProtocolError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def _require_keys(request, allowed):
    extra = set(request) - allowed - {"id", "op"}
    if extra:
        raise ProtocolError("UNKNOWN_PROPERTY")


def _tag(value):
    if not isinstance(value, str) or not value or len(value) > 40:
        raise ProtocolError("REFERENCE_INVALID")
    return value


def _text(value, limit):
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > limit:
        raise ProtocolError("REFERENCE_INVALID")
    return value or None


def _attributes(value):
    if not isinstance(value, dict) or len(value) > 32:
        raise ProtocolError("REFERENCE_INVALID")
    out = {}
    for key, raw in value.items():
        if not isinstance(key, str) or len(key) > 40 or not isinstance(raw, str) or len(raw) > 120:
            raise ProtocolError("REFERENCE_INVALID")
        out[key] = raw
    return out


def _tags(value, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise ProtocolError("REFERENCE_INVALID")
    return tuple(_tag(item) for item in value)


def _reference_to_dict(reference):
    """AWKIT's bounded, redacted reference, in the shape Scrapling's scorer compares."""
    if not isinstance(reference, dict) or not isinstance(reference.get("element"), dict):
        raise ProtocolError("REFERENCE_INVALID")
    element = reference["element"]
    result = {
        "tag": _tag(element.get("tag")),
        "attributes": _attributes(element.get("attributes")),
        "text": _text(element.get("text"), 120),
        "path": _tags(element.get("path"), 12),
    }
    if not result["path"]:
        raise ProtocolError("REFERENCE_INVALID")
    parent = element.get("parent")
    if parent is not None:
        if not isinstance(parent, dict):
            raise ProtocolError("REFERENCE_INVALID")
        result["parent_name"] = _tag(parent.get("tag"))
        result["parent_attribs"] = _attributes(parent.get("attributes"))
        result["parent_text"] = _text(parent.get("text"), 80)
    siblings = _tags(element.get("siblings", []), 20)
    if siblings:
        result["siblings"] = siblings
    children = _tags(element.get("children", []), 20)
    if children:
        result["children"] = children
    return result


def _html(request):
    html = request.get("html")
    if not isinstance(html, str) or len(html.encode("utf-8")) > MAX_HTML_BYTES:
        raise ProtocolError("HTML_INVALID")
    return html


def op_hello(request):
    _require_keys(request, {"protocol"})
    if request.get("protocol") != PROTOCOL_VERSION:
        raise ProtocolError("INCOMPATIBLE_PROTOCOL")
    if _SCORER is None or scrapling.__version__ != EXPECTED_SCRAPLING:
        raise ProtocolError("INCOMPATIBLE_RUNTIME")
    return {
        "protocol": PROTOCOL_VERSION,
        "mode": "parser-only",
        "python": sys.version.split()[0],
        "scrapling": scrapling.__version__,
        "lxml": lxml.__version__,
        "auditHook": True,
        "network": not _refused("socket"),
        "browser": not (_refused("playwright") and _refused("patchright")),
        "forbiddenModulesLoaded": _loaded_forbidden(),
        "startupMs": round((time.perf_counter() - STARTED) * 1000, 1),
    }


def op_health(request):
    _require_keys(request, set())
    return {"uptimeMs": round((time.perf_counter() - STARTED) * 1000), "requests": REQUESTS, "forbiddenModulesLoaded": _loaded_forbidden()}


def op_save_reference(request):
    _require_keys(request, {"reference"})
    return {"fields": sorted(_reference_to_dict(request.get("reference")).keys())}


MAX_CANDIDATE_INDICES = 5000
MAX_SIMILAR = 200

# L12.3: the last parsed snapshot. Several failed lookups on one unchanged page send identical HTML, and the
# diagnosis then asks again for the same page; reusing the parsed tree skips the parse. One entry, compared
# by full string equality, so a different page can never be served from it. Lives only in this process.
_CACHE = {"html": None, "page": None, "stamped": None, "index_of": None}


def _parsed(html):
    """(page, stamped [(index, node)], index_of {node: index}, parse_ms, reused) for a sanitized snapshot."""
    if _CACHE["html"] is not None and _CACHE["html"] == html:
        return _CACHE["page"], _CACHE["stamped"], _CACHE["index_of"], 0.0, True
    started = time.perf_counter()
    page = Selector(html)
    stamped = []
    for node in page._root.iter():
        if not isinstance(node.tag, str):
            continue
        # The stamp is AWKIT's index, not part of the element: it must not take part in any comparison.
        value = node.attrib.pop("data-awkit-v", None)
        if value is not None and value.isdigit():
            stamped.append((int(value), node))
    index_of = {node: index for index, node in stamped}
    parse_ms = (time.perf_counter() - started) * 1000
    _CACHE.update(html=html, page=page, stamped=stamped, index_of=index_of)
    return page, stamped, index_of, parse_ms, False


def _indices(value, limit):
    if not isinstance(value, list) or len(value) > limit or not all(isinstance(item, int) and not isinstance(item, bool) and item >= 0 for item in value):
        raise ProtocolError("BOUNDS_INVALID")
    return set(value)


def op_find_candidates(request):
    _require_keys(request, {"html", "reference", "maxCandidates", "minScore", "candidateIndices"})
    original = _reference_to_dict(request.get("reference"))
    html = _html(request)
    limit = request.get("maxCandidates", 5)
    floor = request.get("minScore", 40)
    if not isinstance(limit, int) or not 1 <= limit <= MAX_CANDIDATES or not isinstance(floor, (int, float)) or not 0 <= floor <= 100:
        raise ProtocolError("BOUNDS_INVALID")
    # L12.2: AWKIT can only ever accept one of its own competitors (same tag or role), so scoring the rest of
    # a large page is wasted work. Absent, every stamped element is scored as before.
    allowed = _indices(request["candidateIndices"], MAX_CANDIDATE_INDICES) if "candidateIndices" in request else None
    page, stamped, _index_of, parse_ms, reused = _parsed(html)
    started = time.perf_counter()
    scored = []
    for index, node in stamped:
        if allowed is not None and index not in allowed:
            continue
        score = _SCORER(page, original, node)
        if score >= floor:
            scored.append((score, index))
    scored.sort(key=lambda item: (-item[0], item[1]))
    match_ms = (time.perf_counter() - started) * 1000
    return {
        "candidates": [{"index": index, "score": score} for score, index in scored[:limit]],
        "elements": len(stamped),
        "parseMs": round(parse_ms, 2),
        "matchMs": round(match_ms, 2),
        "parseReused": reused,
    }


def op_find_similar(request):
    """L12.8/.12/.13: elements alike to one stamped element (same depth, tag, parent and grandparent tags,
    attributes alike), as stamped indices. Scrapling's own find_similar; nothing is fetched or executed."""
    _require_keys(request, {"html", "index", "maxResults"})
    html = _html(request)
    target = request.get("index")
    limit = request.get("maxResults", 50)
    if not isinstance(target, int) or isinstance(target, bool) or target < 0 or not isinstance(limit, int) or not 1 <= limit <= MAX_SIMILAR:
        raise ProtocolError("BOUNDS_INVALID")
    _page, stamped, index_of, parse_ms, reused = _parsed(html)
    started = time.perf_counter()
    node = next((candidate for index, candidate in stamped if index == target), None)
    if node is None:
        raise ProtocolError("INDEX_UNKNOWN")
    similar = []
    total = 0
    for match in Selector(root=node).find_similar():
        index = index_of.get(match._root)
        if index is None:
            continue  # not visible in the browser (never stamped): never offered
        total += 1
        if len(similar) < limit:
            similar.append(index)
    return {
        "index": target,
        "similar": sorted(similar),
        "count": total,
        "parseMs": round(parse_ms, 2),
        "matchMs": round((time.perf_counter() - started) * 1000, 2),
        "parseReused": reused,
    }


INTERACTIVE_ROLES = ("button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "combobox", "textbox", "option")
LANDMARK_TAGS = {"header": "banner", "nav": "navigation", "main": "main", "aside": "complementary", "footer": "contentinfo", "form": "form"}
LANDMARK_ROLES = ("banner", "navigation", "main", "complementary", "contentinfo", "region", "search", "form")


def _clip(value, limit):
    text = " ".join(str(value or "").split())
    return text[:limit]


def _role_of(node):
    explicit = (node.attrib.get("role") or "").strip().lower()
    if explicit:
        return explicit
    tag = node.tag
    kind = (node.attrib.get("type") or "").lower()
    if tag == "button" or (tag == "input" and kind in ("button", "submit", "reset")):
        return "button"
    if tag == "a" and node.attrib.get("href"):
        return "link"
    if tag == "select":
        return "combobox"
    if tag == "textarea" or (tag == "input" and kind not in ("checkbox", "radio")):
        return "textbox"
    if tag == "input":
        return kind
    return ""


def _text_of(selector):
    return _clip(selector.get_all_text(separator=" ", strip=True), 160)


def op_normalize_dom(request):
    _require_keys(request, {"html"})
    html = _html(request)
    started = time.perf_counter()
    page = Selector(html)
    labels = {}
    for label in page.css("label[for]")[:200]:
        labels[label.attrib.get("for")] = _text_of(label)
    truncated = False

    def label_for(node):
        attrib = node.attrib
        return _clip(attrib.get("aria-label") or labels.get(attrib.get("id")) or attrib.get("placeholder") or attrib.get("title") or "", 80)

    landmarks = []
    for node in page.css("header, nav, main, aside, footer, form, section[aria-label], [role]"):
        role = (node.attrib.get("role") or "").lower() or LANDMARK_TAGS.get(node.tag, "region")
        if role not in LANDMARK_ROLES:
            continue
        if len(landmarks) >= 20:
            truncated = True
            break
        landmarks.append({"role": role, "label": _clip(node.attrib.get("aria-label") or "", 80)})
    headings = []
    for node in page.css("h1, h2, h3, h4, h5, h6"):
        if len(headings) >= 30:
            truncated = True
            break
        headings.append({"level": int(node.tag[1]), "text": _text_of(node)[:120]})
    interactive = []
    for node in page.css("button, a[href], input, select, textarea, [role]"):
        role = _role_of(node)
        if role not in INTERACTIVE_ROLES:
            continue
        if len(interactive) >= 60:
            truncated = True
            break
        name = label_for(node) or _text_of(node)[:80] or _clip(node.attrib.get("alt") or "", 80)
        entry = {"role": role, "name": name}
        if "disabled" in node.attrib or node.attrib.get("aria-disabled") == "true":
            entry["disabled"] = True
        interactive.append(entry)
    alerts = []
    for node in page.css('[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]'):
        text = _text_of(node)
        if not text:
            continue
        if len(alerts) >= 10:
            truncated = True
            break
        alerts.append(text[:200])
    forms = []
    for form in page.css("form"):
        if len(forms) >= 10:
            truncated = True
            break
        fields = []
        for node in form.css("input, select, textarea"):
            if len(fields) >= 20:
                truncated = True
                break
            field = {"role": _role_of(node), "label": label_for(node)}
            if "required" in node.attrib or node.attrib.get("aria-required") == "true":
                field["required"] = True
            if node.attrib.get("aria-invalid") == "true":
                field["invalid"] = True
            fields.append(field)
        forms.append({"label": _clip(form.attrib.get("aria-label") or "", 80), "fields": fields})
    tables = []
    for table in page.css("table, [role=table], [role=grid]"):
        if len(tables) >= 10:
            truncated = True
            break
        caption = table.css("caption")
        tables.append({
            "label": _clip(table.attrib.get("aria-label") or (_text_of(caption[0]) if caption else ""), 80),
            "columns": [_text_of(cell)[:40] for cell in table.css("th, [role=columnheader]")[:12]],
            # Data rows only: a header row is not a record, so an empty table reads as 0 rows.
            "rows": len([row for row in table.css("tr, [role=row]") if row.css("td, [role=cell], [role=gridcell]")]),
        })
    text = []
    for node in page.css("p, li, dd, td, label, legend, span"):
        value = _text_of(node)
        if not value or value in text:
            continue
        if len(text) >= 40:
            truncated = True
            break
        text.append(value)
    return {
        "normalization": {
            "landmarks": landmarks,
            "headings": headings,
            "interactive": interactive,
            "alerts": alerts,
            "forms": forms,
            "tables": tables,
            "text": text,
            "truncated": truncated,
        },
        "ms": round((time.perf_counter() - started) * 1000, 2),
    }


OPERATIONS = {
    "hello": op_hello,
    "health": op_health,
    "save_reference": op_save_reference,
    "find_candidates": op_find_candidates,
    "find_similar": op_find_similar,
    "normalize_dom": op_normalize_dom,
}


def _write(message):
    line = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
    if len(line.encode("utf-8")) > MAX_RESPONSE_BYTES:
        line = json.dumps({"id": message.get("id"), "ok": False, "error": {"code": "RESULT_OVERSIZED", "message": "result exceeds the protocol bound"}})
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def main():
    global REQUESTS
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    stdin = sys.stdin.buffer
    while True:
        raw = stdin.readline(MAX_REQUEST_BYTES + 1)
        if not raw:
            return 0  # EOF: the owner is gone
        if len(raw) > MAX_REQUEST_BYTES or not raw.endswith(b"\n"):
            return 2  # protocol violation: the client never sends an oversized or unterminated line
        try:
            request = json.loads(raw.decode("utf-8"))
        except ValueError:
            return 2
        if not isinstance(request, dict) or not isinstance(request.get("id"), int) or not isinstance(request.get("op"), str):
            return 2
        request_id = request["id"]
        op = request["op"]
        if op == "shutdown":
            _write({"id": request_id, "ok": True, "result": {"bye": True}})
            return 0
        handler = OPERATIONS.get(op)
        REQUESTS += 1
        if handler is None:
            _write({"id": request_id, "ok": False, "error": {"code": "UNKNOWN_OP", "message": "unknown operation"}})
            continue
        try:
            _write({"id": request_id, "ok": True, "result": handler(request)})
        except ProtocolError as error:
            _write({"id": request_id, "ok": False, "error": {"code": error.code, "message": error.code}})
        except Exception as error:  # never echo input: only the exception class crosses the boundary
            _write({"id": request_id, "ok": False, "error": {"code": "HOST_ERROR", "message": type(error).__name__}})


if __name__ == "__main__":
    sys.exit(main())
