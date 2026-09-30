/**
 * verify:dom-intelligence-host: a deliberately misbehaving stand-in for the DOM-intelligence host, so the
 * client's refusal rules are proven against a host that actually breaks them. Never shipped.
 *
 * Usage: node fake_host.mjs <mode>
 *   good          answers hello and find_candidates correctly (the positive control)
 *   network       claims network access in hello
 *   forbidden     reports a forbidden module loaded
 *   malformed     answers find_candidates with invalid JSON
 *   wrong-id      answers find_candidates under an id nobody asked
 *   bad-shape     answers find_candidates with an out-of-range score
 *   oversized     answers find_candidates with a line over the response bound
 *   slow          never answers find_candidates
 *   crash         exits immediately, before hello
 */
import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "good";
if (mode === "crash") process.exit(3);

const hello = {
  protocol: 1,
  mode: "parser-only",
  python: "3.12.10",
  scrapling: "0.4.15",
  lxml: "6.1.3",
  auditHook: true,
  network: mode === "network",
  browser: false,
  forbiddenModulesLoaded: mode === "forbidden" ? ["socket"] : []
};

const write = (line) => process.stdout.write(`${line}\n`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const request = JSON.parse(line);
  if (request.op === "hello") return write(JSON.stringify({ id: request.id, ok: true, result: hello }));
  if (request.op === "shutdown") {
    write(JSON.stringify({ id: request.id, ok: true, result: { bye: true } }));
    process.exit(0);
  }
  if (request.op !== "find_candidates") return write(JSON.stringify({ id: request.id, ok: false, error: { code: "UNKNOWN_OP", message: "unknown operation" } }));
  switch (mode) {
    case "malformed":
      return write("{not json");
    case "wrong-id":
      return write(JSON.stringify({ id: request.id + 1000, ok: true, result: { candidates: [], elements: 0, parseMs: 0, matchMs: 0 } }));
    case "bad-shape":
      return write(JSON.stringify({ id: request.id, ok: true, result: { candidates: [{ index: 1, score: 140 }], elements: 1, parseMs: 0, matchMs: 0 } }));
    case "oversized":
      return write(JSON.stringify({ id: request.id, ok: true, result: { padding: "x".repeat(600 * 1024) } }));
    case "slow":
      return undefined;
    default:
      return write(JSON.stringify({ id: request.id, ok: true, result: { candidates: [{ index: 3, score: 91.5 }], elements: 4, parseMs: 1, matchMs: 1 } }));
  }
});
