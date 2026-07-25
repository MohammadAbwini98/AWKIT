/**
 * Phase 1B sanitisation pipeline: projection allowlist → redactor → policy validator → branded doc.
 *
 * The checks here are adversarial on purpose. A redaction test that only feeds it
 * `password=hunter2` proves almost nothing, because that is the one shape the pre-existing
 * `SecretMasker` already handled. The cases below concentrate on the shapes it does NOT handle —
 * hyphen-delimited secrets, JSON pairs, URLs with query strings, connection strings, JWTs — because
 * those are what a real projection would carry.
 *
 * Run: npx tsx scripts/verify-semantic-policy.mts
 */

import {
  SEMANTIC_DOCUMENT_KINDS,
  SEMANTIC_KIND_IDENTITY,
  SEMANTIC_SCHEMA_VERSION,
  semanticDocumentId,
  semanticHash,
  semanticIds,
  semanticSourceHash,
  type SemanticDocument
} from "@src/semantic/contracts/SemanticDocument";
import {
  isForbiddenField,
  projectForKind,
  SEMANTIC_PROJECTION_ALLOWLIST,
  SEMANTIC_PROJECTORS
} from "@src/semantic/SemanticProjection";
import { REDACTED, SemanticRedactor } from "@src/semantic/SemanticRedactor";
import {
  projectAndValidate,
  validateSemanticDocument,
  SEMANTIC_MAX_CONTENT_LENGTH
} from "@src/semantic/SemanticPolicyValidator";
import { registerSecretValues } from "@src/reports/SecretMasker";

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const redactor = new SemanticRedactor();

console.log("Deterministic identity:\n");
{
  check("the same input always produces the same id", semanticIds.workflow("wf-1") === semanticIds.workflow("wf-1"));
  check("different entities produce different ids", semanticIds.workflow("wf-1") !== semanticIds.workflow("wf-2"));
  check("ids are kind-prefixed", semanticIds.runSummary("run-9").startsWith("run-summary:"));
  check("id components are normalized", semanticDocumentId("workflow", "My Workflow!") === "workflow:my-workflow");
  check("an empty component becomes 'unknown', never an empty segment", semanticDocumentId("workflow", "  ") === "workflow:unknown");

  // Delimiter forging: two different component splits must not collide.
  check("a component cannot inject a delimiter", !semanticDocumentId("workflow", "a:b").split(":").includes("b"));

  // ── current-state vs historical identity ──
  // A workflow id must NOT vary with revision, or re-indexing an edited workflow ADDS a row instead
  // of replacing one and both stay searchable.
  check("current-state kinds are stable across revisions", SEMANTIC_KIND_IDENTITY.workflow === "current-state");
  check("flow is current-state", SEMANTIC_KIND_IDENTITY.flow === "current-state");
  check("documentation is current-state", SEMANTIC_KIND_IDENTITY.documentation === "current-state");
  check("run-failure is historical", SEMANTIC_KIND_IDENTITY["run-failure"] === "historical");
  check("run-summary is historical", SEMANTIC_KIND_IDENTITY["run-summary"] === "historical");
  check("locator-failure is historical", SEMANTIC_KIND_IDENTITY["locator-failure"] === "historical");
  check("every kind declares an identity policy", SEMANTIC_DOCUMENT_KINDS.every((k) => Boolean(SEMANTIC_KIND_IDENTITY[k])));

  // Historical kinds legitimately differ per occurrence.
  check(
    "historical ids differ per attempt",
    semanticIds.runFailure("run-1", "a1", "n1") !== semanticIds.runFailure("run-1", "a2", "n1")
  );
  check(
    "historical ids differ per run",
    semanticIds.runFailure("run-1", "a1", "n1") !== semanticIds.runFailure("run-2", "a1", "n1")
  );

  // ── collision resistance ──
  // `idComponent` lowercases, collapses punctuation and truncates at 120 chars, so distinct long or
  // punctuation-heavy source ids could normalize to the same readable prefix. The trailing hash of
  // the CANONICAL identity is what keeps them apart.
  const longA = `wf-${"a".repeat(200)}-ONE`;
  const longB = `wf-${"a".repeat(200)}-TWO`;
  check("long ids sharing a truncated prefix still differ", semanticIds.workflow(longA) !== semanticIds.workflow(longB), `${semanticIds.workflow(longA)} vs ${semanticIds.workflow(longB)}`);
  check(
    "punctuation-only differences still produce distinct ids",
    semanticIds.workflow("My Workflow") !== semanticIds.workflow("My_Workflow!")
  );
  check("ids carry a hash suffix", /:[0-9a-f]{16}$/.test(semanticIds.workflow("wf-1")), semanticIds.workflow("wf-1"));
  check("the readable prefix is preserved for diagnosability", semanticIds.workflow("my-flow").startsWith("workflow:my-flow:"));

  // Unbounded/free-text inputs must be hashed, never echoed.
  const locator = semanticIds.locatorSuccess("fl", "n1");
  check("a locator id echoes no free text", !/account|row/i.test(locator), locator);
  check("semanticHash is stable", semanticHash("x") === semanticHash("x"));
  check("semanticHash separates different inputs", semanticHash("x") !== semanticHash("y"));
  check("sourceHash detects a content change", semanticSourceHash(["a"]) !== semanticSourceHash(["b"]));
  check("sourceHash is stable for identical parts", semanticSourceHash(["a", "b"]) === semanticSourceHash(["a", "b"]));
  // The separator must prevent ["ab"] and ["a","b"] colliding.
  check("sourceHash parts cannot be re-split ambiguously", semanticSourceHash(["ab"]) !== semanticSourceHash(["a", "b"]));
}

console.log("\nProjection allowlist (structural exclusion):\n");
{
  check("every declared kind has an allowlist", SEMANTIC_DOCUMENT_KINDS.every((k) => SEMANTIC_PROJECTION_ALLOWLIST[k]?.length > 0));

  const r = projectForKind("workflow", { workflowId: "wf-1", name: "Login", unknownField: "dropped" });
  check("allowlisted fields are kept", r.ok && r.projected.workflowId === "wf-1" && r.projected.name === "Login");
  check("unknown fields are silently dropped, not rejected", r.ok && !("unknownField" in r.projected));

  const forbidden = projectForKind("workflow", { workflowId: "wf-1", password: "hunter2" });
  check("a forbidden field is REJECTED, not dropped", !forbidden.ok);
  check(
    "the rejection names the field but never its value",
    !forbidden.ok && forbidden.rejections[0].field === "password" && !JSON.stringify(forbidden.rejections).includes("hunter2")
  );

  // Captured input values are the highest-risk surface: a user may type a password into a field
  // that was never labelled as one.
  for (const field of ["value", "inputValue", "capturedValue", "typedText", "clipboard", "storageState", "cookie"]) {
    check(`'${field}' is structurally forbidden`, isForbiddenField(field));
  }
  check("forbidden matching ignores case and separators", isForbiddenField("API_KEY") && isForbiddenField("apiKey") && isForbiddenField("Access-Token"));
  check("an ordinary field is not forbidden", !isForbiddenField("name") && !isForbiddenField("nodeType"));

  // The locator allowlists must not permit matched element text. Asserted against explicit field
  // names rather than a substring regex: an earlier `/text|value|name$/i` flagged `contextKind`
  // (which contains "text" but is a bounded enum — dialog/row/card/iframe), i.e. the test was wrong,
  // not the allowlist.
  const MATCHED_TEXT_FIELDS = ["matchedText", "text", "innerText", "textContent", "accessibleName", "value", "label", "selector"];
  for (const kind of ["locator-success", "locator-failure"] as const) {
    check(
      `${kind} never allowlists matched element text`,
      !SEMANTIC_PROJECTION_ALLOWLIST[kind].some((f) => MATCHED_TEXT_FIELDS.some((m) => m.toLowerCase() === f.toLowerCase()))
    );
  }
  check(
    "run-failure allowlists errorCategory/errorSummary but never a raw error",
    SEMANTIC_PROJECTION_ALLOWLIST["run-failure"].includes("errorCategory") &&
      !SEMANTIC_PROJECTION_ALLOWLIST["run-failure"].includes("error") &&
      !SEMANTIC_PROJECTION_ALLOWLIST["run-failure"].includes("message")
  );
  check("no allowlist entry is itself a forbidden field", SEMANTIC_DOCUMENT_KINDS.every((k) => !SEMANTIC_PROJECTION_ALLOWLIST[k].some(isForbiddenField)));
}

console.log("\nRedaction — shapes SecretMasker does NOT handle:\n");
{
  const cases: Array<[string, string]> = [
    ["hyphen-delimited secret", "token-SUPERSECRETVALUE"],
    ["underscore-delimited secret", "api_key_ABCDEF123456"],
    ["space-delimited secret", "password hunter2xyz"],
    ["JSON pair", '{"token": "abc123def456"}'],
    ["YAML pair", "client_secret: s3cr3tvalue"],
    ["connection string", "jdbc:oracle:thin:@host;password=Sup3rSecret;"],
    ["Basic auth", "Authorization: Basic QWxhZGRpbjpvcGVuc2VzYW1l"],
    ["JWT", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc"],
    ["url with token query", "https://example.com/cb?token=abc123&session=xyz"],
    ["windows path", "C:\\Users\\moham\\AppData\\secrets.json"],
    ["email", "contact person@example.com now"],
    ["long numeric id", "card 4111111111111111 used"]
  ];

  for (const [label, input] of cases) {
    const out = redactor.redactText(input);
    // The assertion is that the SENSITIVE PART is gone, not merely that output != input.
    const leaked = /SUPERSECRETVALUE|ABCDEF123456|hunter2xyz|abc123def456|s3cr3tvalue|Sup3rSecret|QWxhZGRpbjpvcGVuc2VzYW1l|eyJhbGciOi|xyz|moham|person@example\.com|4111111111111111/.test(out);
    check(`${label} is redacted`, !leaked, `${input} → ${out}`);
  }

  check("redacted output marks the removal", redactor.redactText("token-SECRETVALUE").includes(REDACTED));
  check("ordinary prose is left readable", redactor.redactText("Login flow opens the dashboard") === "Login flow opens the dashboard");
  check("empty input is safe", redactor.redactText("") === "");

  // Registered run secrets: arbitrary strings no pattern could infer.
  registerSecretValues(["zzzUniqueRunSecret"]);
  check("registered run secrets are removed", !new SemanticRedactor().redactText("value zzzUniqueRunSecret here").includes("zzzUniqueRunSecret"));

  // Custom user terms.
  const custom = new SemanticRedactor({ customSensitiveTerms: ["ProjectAtlas"] });
  check("custom sensitive terms are removed", !custom.redactText("ProjectAtlas is internal").includes("ProjectAtlas"));

  // Policy knobs.
  const lenient = new SemanticRedactor({ redactEmails: false, minNumericIdentifierLength: 20 });
  check("email redaction can be disabled by policy", lenient.redactText("a@b.co").includes("a@b.co"));
  check("the numeric threshold is honoured", lenient.redactText("order 123456").includes("123456"));

  // Nested records.
  const rec = redactor.redactRecord({ a: "token-LEAKME", nested: { b: ["password=LEAKTOO"] } });
  check("redactRecord recurses through objects and arrays", !JSON.stringify(rec).includes("LEAKME") && !JSON.stringify(rec).includes("LEAKTOO"));
  check("redactRecord preserves non-string values", redactor.redactRecord({ n: 5, b: true }).n === 5);
}

console.log("\nPolicy validator (independent re-scan):\n");

function candidate(overrides: Partial<SemanticDocument> = {}): SemanticDocument {
  return {
    id: "workflow:wf-1:r1",
    kind: "workflow",
    entityId: "wf-1",
    revision: "r1",
    sourceHash: semanticSourceHash(["x"]),
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    title: "Login workflow",
    content: "Signs in and opens the dashboard.",
    tags: ["auth"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

{
  check("a clean document validates", validateSemanticDocument(candidate()).ok);

  const missing = validateSemanticDocument(candidate({ entityId: "", revision: "" }));
  check("missing source references are rejected", !missing.ok);
  check("ALL failures are collected, not just the first", !missing.ok && missing.rejections.length >= 2, String(!missing.ok && missing.rejections.length));

  check("an oversized document is rejected", !validateSemanticDocument(candidate({ content: "x".repeat(SEMANTIC_MAX_CONTENT_LENGTH + 1) })).ok);
  check("a bad schema version is rejected", !validateSemanticDocument(candidate({ schemaVersion: 999 })).ok);
  check("a malformed id is rejected", !validateSemanticDocument(candidate({ id: "noDelimiter" })).ok);
  check("an unsupported kind is rejected", !validateSemanticDocument(candidate({ kind: "nope" as never })).ok);
  check(
    "a kind disabled in this build is rejected",
    !validateSemanticDocument(candidate(), { supportedKinds: ["flow"] }).ok
  );

  // The re-scan: content that the redactor would have caught, arriving unredacted.
  for (const [label, content] of [
    ["jwt", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"],
    ["bearer", "Authorization: Bearer abcdef123456"],
    ["key/value", "password: hunter2"],
    ["url with query", "https://x.com/a?token=1"],
    ["windows user path", "C:\\Users\\moham\\x"],
    ["private key", "-----BEGIN RSA PRIVATE KEY-----"]
  ] as const) {
    check(`the validator independently catches an unredacted ${label}`, !validateSemanticDocument(candidate({ content })).ok);
  }
  check("the re-scan also covers the title", !validateSemanticDocument(candidate({ title: "Bearer abcdef123456" })).ok);
  check("the re-scan also covers tags", !validateSemanticDocument(candidate({ tags: ["password: hunter2"] })).ok);

  check(
    "a rejection detail never contains the offending value",
    (() => {
      const r = validateSemanticDocument(candidate({ content: "password: hunter2secret" }));
      return !r.ok && !JSON.stringify(r.rejections).includes("hunter2secret");
    })()
  );

  check(
    "an embedding dimension mismatch is rejected",
    !validateSemanticDocument(candidate({ embedding: new Float32Array(3) }), { expectedEmbeddingDimension: 8 }).ok
  );
  check(
    "a matching embedding dimension is accepted",
    validateSemanticDocument(candidate({ embedding: new Float32Array(8) }), { expectedEmbeddingDimension: 8 }).ok
  );

  // Immutability of the branded result.
  const ok = validateSemanticDocument(candidate());
  if (ok.ok) {
    check("a validated document is frozen", Object.isFrozen(ok.document));
    check("its tags array is frozen too", Object.isFrozen(ok.document.tags));
    let mutated = false;
    try {
      (ok.document as unknown as SemanticDocument).content = "tampered";
      mutated = (ok.document as unknown as SemanticDocument).content === "tampered";
    } catch {
      mutated = false; // strict-mode throw is the stronger outcome
    }
    check("a validated document cannot be mutated after branding", !mutated);
  } else {
    check("a validated document is frozen", false, "validation unexpectedly failed");
  }
}

console.log("\nFull pipeline (project → redact → validate → brand):\n");
{
  const built = projectAndValidate("run-failure", {
    runId: "run-1",
    attemptId: "a1",
    nodeId: "n1",
    nodeType: "click",
    errorCategory: "timeout",
    errorSummary: "Element not visible",
    hostname: "app.example.com",
    updatedAt: new Date().toISOString()
  });

  check("the pipeline accepts a well-formed failure projection", built.ok, built.ok ? "" : JSON.stringify(built.rejections));
  if (built.ok) {
    check("allowlisted context is preserved", built.document.content.includes("timeout"));
    check("the document is branded and frozen", Object.isFrozen(built.document));
    check("the factory computed the id", built.document.id.startsWith("run-failure:"), built.document.id);
    check("the factory computed the sourceHash", built.document.sourceHash.length === 64);
  }

  // ── the projection bypass ──
  // A caller can no longer hand over free-form indexable text. Anything not on the kind's allowlist
  // is dropped before redaction ever runs, so a pattern gap cannot leak it.
  const smuggled = projectAndValidate("workflow", {
    workflowId: "wf-smuggle",
    name: "Innocent",
    // Every one of these is either forbidden or simply not allowlisted for `workflow`.
    body: "https://app.example.com/cb?token=SMUGGLEDTOKEN",
    notes: "password=SMUGGLEDPASSWORD",
    rawDefinition: JSON.stringify({ apiKey: "SMUGGLEDKEY" })
  });
  check("the pipeline still accepts the document", smuggled.ok, smuggled.ok ? "" : JSON.stringify(smuggled.rejections));
  if (smuggled.ok) {
    const serialized = JSON.stringify(smuggled.document);
    check("a non-allowlisted 'body' never reaches the document", !serialized.includes("SMUGGLEDTOKEN"), serialized.slice(0, 200));
    check("non-allowlisted notes never reach the document", !serialized.includes("SMUGGLEDPASSWORD"));
    check("a non-allowlisted raw definition never reaches the document", !serialized.includes("SMUGGLEDKEY"));
    check("the allowlisted name survives", smuggled.document.title === "Innocent");
  }

  // A forbidden source field must stop the whole pipeline.
  const blocked = projectAndValidate("run-failure", {
    runId: "run-2",
    capturedValue: "whatever-the-user-typed"
  });
  check("a forbidden source field stops the pipeline", !blocked.ok);
  check(
    "the pipeline rejection never echoes the forbidden value",
    !blocked.ok && !JSON.stringify(blocked.rejections).includes("whatever-the-user-typed")
  );

  // A missing required identity field is a rejection, not a document with an invented id.
  const noId = projectAndValidate("workflow", { name: "No id here" });
  check("a missing required identity field is rejected", !noId.ok);
  check("the rejection names the missing field", !noId.ok && JSON.stringify(noId.rejections).includes("workflowId"));

  // Determinism.
  const twice = () =>
    projectAndValidate("workflow", {
      workflowId: "wf-9",
      name: "Stable",
      description: "Stable description",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
  const a = twice();
  const b = twice();
  check(
    "the pipeline is deterministic for identical input",
    a.ok && b.ok && a.document.id === b.document.id && a.document.content === b.document.content
  );

  // ── revision changes REPLACE, they do not accumulate ──
  const r1 = projectAndValidate("workflow", { workflowId: "wf-rev", name: "V1", description: "first", revision: "1" });
  const r2 = projectAndValidate("workflow", { workflowId: "wf-rev", name: "V2", description: "second", revision: "2" });
  check("two revisions of one workflow share ONE document id", r1.ok && r2.ok && r1.document.id === r2.document.id, r1.ok && r2.ok ? `${r1.document.id} vs ${r2.document.id}` : "build failed");
  check("the revision is retained as a FIELD", r2.ok && r2.document.revision === "2", r2.ok ? r2.document.revision : "");
  check("content reflects the newer revision", r2.ok && r2.document.content.includes("second"));
  check("sourceHash changes with content", r1.ok && r2.ok && r1.document.sourceHash !== r2.document.sourceHash);

  // Historical kinds behave the opposite way, on purpose.
  const f1 = projectAndValidate("run-failure", { runId: "run-h", attemptId: "a1", nodeId: "n1", errorCategory: "timeout" });
  const f2 = projectAndValidate("run-failure", { runId: "run-h", attemptId: "a2", nodeId: "n1", errorCategory: "timeout" });
  check("two attempts of one run are DISTINCT documents", f1.ok && f2.ok && f1.document.id !== f2.document.id);
}

console.log("\nProjectors derive everything from allowlisted fields:\n");
{
  for (const kind of SEMANTIC_DOCUMENT_KINDS) {
    check(`${kind} has a projector`, typeof SEMANTIC_PROJECTORS[kind] === "function");
  }

  const flow = projectAndValidate("flow", {
    flowId: "fl-1",
    workflowId: "wf-1",
    name: "Login flow",
    description: "signs in",
    nodeTypes: ["click", "fill"],
    tags: ["auth"]
  });
  check("a flow projects its allowlisted fields", flow.ok && flow.document.content.includes("click"), flow.ok ? flow.document.content : "");
  check("a flow carries its filter dimensions", flow.ok && flow.document.flowId === "fl-1" && flow.document.workflowId === "wf-1");

  const locator = projectAndValidate("locator-success", {
    flowId: "fl-1",
    nodeId: "n-1",
    nodeType: "click",
    locatorStrategy: "role",
    locatorRole: "button",
    contextKind: "dialog",
    hostname: "app.example.com",
    // Not allowlisted: the matched element text, which routinely carries user data.
    matchedText: "Account 4111111111111111"
  });
  check("a locator document is projected", locator.ok, locator.ok ? "" : JSON.stringify(locator.rejections));
  check(
    "matched element text never reaches a locator document",
    locator.ok && !JSON.stringify(locator.document).includes("4111111111111111")
  );
  check("the locator strategy IS recorded", locator.ok && locator.document.content.includes("role"));

  const doc = projectAndValidate("documentation", {
    relativePath: "docs/a.md",
    title: "Guide",
    headings: ["Intro"],
    body: "Some documentation prose."
  });
  check("documentation projects its allowlisted body", doc.ok && doc.document.content.includes("documentation prose"));
  check("documentation identity is its path", doc.ok && doc.document.entityId === "docs/a.md");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
