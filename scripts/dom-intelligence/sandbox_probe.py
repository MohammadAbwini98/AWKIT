"""verify:dom-intelligence-host probe: run INSIDE the staged runtime to prove the host's sandbox.

Usage: python.exe -I -B -s -E -X utf8 sandbox_probe.py <host-dir> <scratch-dir> [--control]

With `--control` the host is NOT imported, and one write into the scratch directory must SUCCEED: that
proves a refusal in the real run comes from the host's audit hook, not from the environment. Without it,
the host module is imported (installing its hook exactly as a launch does, without running its loop) and
every forbidden operation must be refused. Prints one JSON object: {name: refused?}.
Never shipped: it lives in scripts/, not in the staged tree.
"""
import json
import os
import sys

host_dir, scratch = sys.argv[1], sys.argv[2]
control = "--control" in sys.argv[3:]
results = {}


def attempt(name, action):
    try:
        action()
    except BaseException as error:  # noqa: BLE001 - any refusal counts
        results[name] = {"refused": True, "error": type(error).__name__}
        return
    results[name] = {"refused": False}


if control:
    attempt("control-write", lambda: open(os.path.join(scratch, "control.txt"), "w").close())
    print(json.dumps(results))
    sys.exit(0)

sys.path.insert(0, host_dir)
import dom_intelligence_host  # noqa: E402,F401 - installs the audit hook and the urllib.request stub

attempt("import-socket", lambda: __import__("socket"))
attempt("import-ssl", lambda: __import__("ssl"))
attempt("import-subprocess", lambda: __import__("subprocess"))
attempt("import-ctypes", lambda: __import__("ctypes"))
attempt("import-asyncio", lambda: __import__("asyncio"))
attempt("import-http-client", lambda: __import__("http.client"))
attempt("import-playwright", lambda: __import__("playwright"))
attempt("import-patchright", lambda: __import__("patchright"))
attempt("import-scrapling-fetchers", lambda: __import__("scrapling.fetchers"))
attempt("import-scrapling-spiders", lambda: __import__("scrapling.spiders"))
attempt("import-scrapling-engines", lambda: __import__("scrapling.engines"))
attempt("import-scrapling-shell", lambda: __import__("scrapling.core.shell"))
attempt("import-tld", lambda: __import__("tld"))
attempt("write-file", lambda: open(os.path.join(scratch, "blocked.txt"), "w").close())
attempt("append-file", lambda: open(os.path.join(scratch, "blocked.txt"), "a").close())
attempt("os-open-write", lambda: os.open(os.path.join(scratch, "blocked-os.txt"), os.O_WRONLY | os.O_CREAT))
attempt("remove-file", lambda: os.remove(os.path.join(scratch, "control.txt")))
attempt("rename-file", lambda: os.rename(os.path.join(scratch, "control.txt"), os.path.join(scratch, "moved.txt")))
attempt("make-directory", lambda: os.mkdir(os.path.join(scratch, "made")))
attempt("os-system", lambda: os.system("echo awkit"))
attempt("os-startfile", lambda: os.startfile(scratch))
attempt("putenv", lambda: os.putenv("AWKIT_PROBE", "1"))
attempt("chdir", lambda: os.chdir(scratch))
attempt("sqlite-connect", lambda: __import__("sqlite3").connect(":memory:"))
attempt("winapi-create-process", lambda: __import__("_winapi").CreateProcess(None, "cmd /c echo awkit", None, None, False, 0, None, None, None))
_second_hook_calls = []


def _add_second_hook():
    # CPython suppresses a RuntimeError raised against `sys.addaudithook` and simply does not add the new
    # hook, so the refusal is proven by the second hook never being called.
    sys.addaudithook(lambda event, args: _second_hook_calls.append(event))
    sys.audit("awkit.probe")
    if _second_hook_calls:
        return
    raise LookupError("the second audit hook was not installed")


attempt("add-audit-hook", _add_second_hook)


def _urlopen_absent():
    import urllib.request

    if hasattr(urllib.request, "urlopen"):
        return
    raise LookupError("urllib.request is the pathname2url-only stub")


attempt("urlopen-available", _urlopen_absent)
print(json.dumps(results))
