"""L10.0 benchmark host: parser-only Scrapling behind a JSON-lines protocol on stdin/stdout.

Dev-only and never shipped. Driven by scripts/benchmark-dom-intelligence.mts through the venv built by
`npm run benchmark:dom-intelligence-setup`. It only parses HTML it is given: no network, no browser,
no storage (relocation runs on an in-memory element dictionary, so Scrapling's default SQLite store,
which lives inside the package directory, is never created).
"""
import ctypes
import importlib.metadata as metadata
import json
import os
import sys
import time

T0 = time.perf_counter()
from scrapling.parser import Selector, _find_all_elements  # noqa: E402
from scrapling.core.utils import _StorageTools  # noqa: E402

IMPORT_MS = (time.perf_counter() - T0) * 1000

FORBIDDEN_MODULE_PREFIXES = (
    "playwright",
    "patchright",
    "curl_cffi",
    "browserforge",
    "mcp",
    "scrapling.fetchers",
    "scrapling.spiders",
    "scrapling.engines",
    "scrapling.core.ai",
    "scrapling.core.shell",
)


class _Counters(ctypes.Structure):
    _fields_ = [
        ("cb", ctypes.c_ulong),
        ("PageFaultCount", ctypes.c_ulong),
        ("PeakWorkingSetSize", ctypes.c_size_t),
        ("WorkingSetSize", ctypes.c_size_t),
        ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPagedPoolUsage", ctypes.c_size_t),
        ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
        ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
        ("PagefileUsage", ctypes.c_size_t),
        ("PeakPagefileUsage", ctypes.c_size_t),
    ]


def memory():
    if os.name != "nt":
        return None
    counters = _Counters()
    counters.cb = ctypes.sizeof(_Counters)
    kernel32 = ctypes.windll.kernel32
    kernel32.GetCurrentProcess.restype = ctypes.c_void_p
    psapi = ctypes.windll.psapi
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_Counters), ctypes.c_ulong]
    if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
        return None
    return {"workingSetBytes": counters.WorkingSetSize, "peakWorkingSetBytes": counters.PeakWorkingSetSize}


def loaded_forbidden():
    return sorted(name for name in sys.modules if name.startswith(FORBIDDEN_MODULE_PREFIXES))


def score_table(page, reference):
    scorer = page._Selector__calculate_similarity_score  # the exact scorer relocate() uses
    tree = page._root.getroottree()
    return sorted(
        ((scorer(reference, node), tree.getpath(node)) for node in _find_all_elements(page._root)),
        key=lambda item: -item[0],
    )


def op_relocate(request):
    baseline = Selector(request["baselineHtml"])
    targets = baseline.css(request["targetSelector"])
    if len(targets) != 1:
        raise ValueError(f"baseline target selector matched {len(targets)} elements")
    reference = _StorageTools.element_to_dict(targets[0]._root)

    started = time.perf_counter()
    page = Selector(request["mutatedHtml"])
    parse_ms = (time.perf_counter() - started) * 1000
    started = time.perf_counter()
    found = page.relocate(reference, percentage=request.get("percentage", 40))
    relocate_ms = (time.perf_counter() - started) * 1000

    tree = page._root.getroottree()
    paths = [tree.getpath(node) for node in found]
    truth_path = None
    if request.get("truthSelector"):
        truth = page.css(request["truthSelector"])
        if len(truth) != 1:
            raise ValueError(f"truth selector matched {len(truth)} elements")
        truth_path = tree.getpath(truth[0]._root)

    table = score_table(page, reference)
    top = table[0][0] if table else None
    runner_up = next((score for score, path in table if score < top), None) if table else None
    truth_rank = None
    truth_score = None
    if truth_path:
        for index, (score, path) in enumerate(table):
            if path == truth_path:
                truth_rank, truth_score = index + 1, score
                break
    correct = None
    if len(paths) == 1:
        correct = truth_path is not None and paths[0] == truth_path
    elif len(paths) > 1:
        correct = False
    return {
        "candidates": paths,
        "topScore": top if paths else (top if top is not None else None),
        "acceptedAtThreshold": bool(paths),
        "runnerUpScore": runner_up,
        "truthPath": truth_path,
        "truthRank": truth_rank,
        "truthScore": truth_score,
        "correct": correct,
        "parseMs": parse_ms,
        "relocateMs": relocate_ms,
        "referenceFields": sorted(reference.keys()),
        "referenceAttributeKeys": sorted(reference.get("attributes", {}).keys()),
    }


def op_timing(request):
    """Warm timing: parse + relocate repeated; returns per-iteration milliseconds."""
    baseline = Selector(request["baselineHtml"])
    reference = _StorageTools.element_to_dict(baseline.css(request["targetSelector"])[0]._root)
    samples = []
    for _ in range(request["repeat"]):
        started = time.perf_counter()
        Selector(request["mutatedHtml"]).relocate(reference, percentage=40)
        samples.append((time.perf_counter() - started) * 1000)
    return {"samples": samples}


def synthetic_page(elements, target_id):
    sections = []
    count = 0
    index = 0
    while count < elements - 12:
        sections.append(
            f'<section class="card"><h3>Card {index}</h3><p>Item {index} details</p>'
            f'<a href="/item/{index}">Open</a><button type="button" class="btn">Edit</button></section>'
        )
        count += 6
        index += 1
    return (
        "<!doctype html><html><head><title>Scale</title></head><body><main>"
        + "".join(sections)
        + f'<form><div class="actions"><button type="button" class="btn btn-primary" id="{target_id}">Save changes</button></div></form>'
        + "</main></body></html>"
    )


def op_scale(request):
    results = []
    for size in request["sizes"]:
        baseline_html = synthetic_page(size, "save-order")
        mutated_html = synthetic_page(size, "order-save")
        reference = _StorageTools.element_to_dict(Selector(baseline_html).css("#save-order")[0]._root)
        samples = []
        found = []
        for _ in range(request["repeat"]):
            started = time.perf_counter()
            page = Selector(mutated_html)
            found = page.relocate(reference, percentage=40)
            samples.append((time.perf_counter() - started) * 1000)
        element_count = len(_find_all_elements(Selector(mutated_html)._root))
        results.append({
            "requestedElements": size,
            "elements": element_count,
            "htmlBytes": len(mutated_html.encode("utf-8")),
            "samples": samples,
            "found": len(found),
        })
    return {"series": results}


def op_normalize(request):
    started = time.perf_counter()
    text = Selector(request["html"]).get_all_text(
        separator="\n", strip=True, ignore_tags=("script", "style", "noscript", "template")
    )
    return {"text": str(text), "ms": (time.perf_counter() - started) * 1000}


def directory_bytes(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def op_inventory(_request):
    distributions = []
    for dist in sorted(metadata.distributions(), key=lambda d: d.metadata["Name"].lower()):
        files = dist.files or []
        size = 0
        for file in files:
            try:
                size += os.path.getsize(dist.locate_file(file))
            except OSError:
                pass
        classifiers = [c for c in (dist.metadata.get_all("Classifier") or []) if c.startswith("License")]
        raw_license = (dist.metadata.get("License-Expression") or dist.metadata.get("License") or "").strip()
        distributions.append({
            "name": dist.metadata["Name"],
            "version": dist.version,
            "license": raw_license.splitlines()[0] if raw_license else "",
            "licenseClassifiers": classifiers,
            "requiresDist": dist.metadata.get_all("Requires-Dist") or [],
            "installedBytes": size,
        })
    import scrapling

    package_dir = os.path.dirname(scrapling.__file__)
    breakdown = {}
    for name in sorted(os.listdir(package_dir)):
        full = os.path.join(package_dir, name)
        breakdown[name] = directory_bytes(full) if os.path.isdir(full) else os.path.getsize(full)
    # Stdlib and extension modules actually loaded by the parser path: a lower bound for a trimmed runtime.
    stdlib_prefix = os.path.normcase(os.path.dirname(os.__file__))
    base_prefix = os.path.normcase(sys.base_prefix)
    loaded = 0
    loaded_count = 0
    for module in list(sys.modules.values()):
        path = getattr(module, "__file__", None)
        if path and os.path.normcase(path).startswith((stdlib_prefix, base_prefix)) and os.path.exists(path):
            loaded += os.path.getsize(path)
            loaded_count += 1
    runtime_dlls = {}
    for name in ("python312.dll", "python3.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
        path = os.path.join(sys.base_prefix, name)
        if os.path.exists(path):
            runtime_dlls[name] = os.path.getsize(path)
    return {
        "python": sys.version.split()[0],
        "distributions": distributions,
        "scraplingPackageBreakdown": breakdown,
        # Relative to site-packages: the default store sits INSIDE the installed package directory.
        "defaultAdaptiveDbPath": os.path.relpath(
            os.path.join(package_dir, "elements_storage.db"), os.path.dirname(package_dir)
        ).replace("\\", "/"),
        "defaultAdaptiveDbExists": os.path.exists(os.path.join(package_dir, "elements_storage.db")),
        "loadedStdlibModules": loaded_count,
        "loadedStdlibBytes": loaded,
        "runtimeDlls": runtime_dlls,
        "forbiddenModulesLoaded": loaded_forbidden(),
    }


OPS = {
    "relocate": op_relocate,
    "timing": op_timing,
    "scale": op_scale,
    "normalize": op_normalize,
    "inventory": op_inventory,
    "memory": lambda _request: memory(),
}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    print(json.dumps({
        "op": "ready",
        "importMs": IMPORT_MS,
        "python": sys.version.split()[0],
        "forbiddenModulesLoaded": loaded_forbidden(),
        "memory": memory(),
    }), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        if request.get("op") == "exit":
            break
        try:
            result = OPS[request["op"]](request)
            print(json.dumps({"ok": True, "result": result}), flush=True)
        except Exception as error:  # report, keep serving
            print(json.dumps({"ok": False, "error": f"{type(error).__name__}: {error}"}), flush=True)


if __name__ == "__main__":
    main()
