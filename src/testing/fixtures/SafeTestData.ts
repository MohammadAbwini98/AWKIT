/**
 * Deterministic, safe fixture data for the Randomized Automation Test Lab.
 *
 * Every locator here was read from `mock-site/public/*.html`, so a generated flow targets an
 * element that actually exists and Phase 5 (live execution) needs no rework of the pool.
 *
 * Safety rules enforced by construction:
 * - No real names, emails, addresses or employee identity data. Everything is obviously synthetic.
 * - **No plaintext secrets anywhere.** Secret-backed values are represented only by opaque
 *   *references* (`SECRET_REFERENCES`) that the lab never resolves. A fixture, snapshot, diff or
 *   artifact containing one of these strings has leaked nothing.
 * - No destructive targets: nothing here submits a payment, deletes a record or leaves the mock
 *   site.
 *
 * Framework-agnostic: no Electron, no React, no Node built-ins.
 */
import type { LocatorCandidate, LocatorStrategy } from "../../profiles/FlowProfile";

/** A page of the local mock site, with targets verified against its markup. */
export interface MockPageFixture {
  /** Path appended to `constraints.baseUrl`. */
  readonly path: string;
  readonly title: string;
  /** Clickable controls that do not navigate away or mutate destructively. */
  readonly clickTargets: readonly LocatorCandidate[];
  /** Text inputs / textareas safe to fill. */
  readonly fillTargets: readonly LocatorCandidate[];
  /** `<select>` controls, with an option value known to exist. */
  readonly selectTargets: readonly { locator: LocatorCandidate; option: string }[];
  /** Checkboxes safe to check/uncheck. */
  readonly checkTargets: readonly LocatorCandidate[];
  /** Radio inputs, with the value they carry. */
  readonly radioTargets: readonly { locator: LocatorCandidate; value: string }[];
  /** Elements stable enough to assert visibility/text on. */
  readonly assertTargets: readonly LocatorCandidate[];
}

const css = (value: string): LocatorCandidate => ({ strategy: "css", value });
const testId = (value: string): LocatorCandidate => ({ strategy: "testId", value });
const id = (value: string): LocatorCandidate => ({ strategy: "id", value });

export const MOCK_PAGES: readonly MockPageFixture[] = [
  {
    path: "/",
    title: "Feature Test Lab",
    clickTargets: [testId("scenario-core-form"), testId("scenario-smart-waits")],
    fillTargets: [],
    selectTargets: [],
    checkTargets: [],
    radioTargets: [],
    assertTargets: [css("h1"), testId("scenario-designer")]
  },
  {
    path: "/form.html",
    title: "Customer Form",
    clickTargets: [id("resetButton")],
    fillTargets: [id("firstName"), id("lastName"), id("email"), id("description")],
    selectTargets: [
      { locator: id("country"), option: "US" },
      { locator: id("accountType"), option: "personal" }
    ],
    checkTargets: [id("interestAutomation"), id("interestTesting"), id("acceptTerms")],
    radioTargets: [
      { locator: id("genderMale"), value: "MALE" },
      { locator: id("genderFemale"), value: "FEMALE" }
    ],
    assertTargets: [css("h1"), id("submitButton")]
  },
  {
    path: "/smart-waits.html",
    title: "Smart Wait and Runner Lab",
    clickTargets: [testId("wait-element-visible"), testId("wait-text-change"), testId("reset-smart-waits")],
    fillTargets: [testId("delay-ms")],
    selectTargets: [],
    checkTargets: [],
    radioTargets: [],
    assertTargets: [css("h1"), testId("appeared-element"), testId("changing-text")]
  },
  {
    path: "/details.html",
    title: "Details Tab",
    clickTargets: [],
    fillTargets: [],
    selectTargets: [],
    checkTargets: [],
    radioTargets: [],
    assertTargets: [id("routeChangeTargetTitle")]
  }
] as const;

/**
 * Opaque secret *references*. These are names in the encrypted local secret store — not secrets.
 *
 * Phase 3 uses these to prove a `valueSource: { type: "secret" }` survives a round trip **without
 * ever resolving it**. If a diff, log or artifact prints one of these, nothing sensitive leaked;
 * that is exactly why the lab never generates a `value` alongside a secret source.
 */
export const SECRET_REFERENCES: readonly string[] = [
  "awkit-lab-secret-ref-0001",
  "awkit-lab-secret-ref-0002",
  "awkit-lab-secret-ref-0003"
];

/** Obviously-synthetic fill values. Nothing here resembles production identity data. */
export const SAFE_TEXT_VALUES: readonly string[] = [
  "lab-alpha",
  "lab-bravo",
  "lab-charlie",
  "lab-delta",
  "lab-echo"
];

export const SAFE_EMAIL_VALUES: readonly string[] = [
  "lab-user-01@example.invalid",
  "lab-user-02@example.invalid",
  "lab-user-03@example.invalid"
];

/** Environment variable names a generated `env` value source may reference. Never read here. */
export const SAFE_ENV_KEYS: readonly string[] = [
  "AWKIT_LAB_ENV_ALPHA",
  "AWKIT_LAB_ENV_BRAVO"
];

export const SAFE_RUNTIME_INPUT_KEYS: readonly string[] = ["labInputAlpha", "labInputBravo"];

export const SAFE_OUTPUT_KEYS: readonly string[] = ["labOutputAlpha", "labOutputBravo"];

export const SAFE_INSTANCE_VARIABLES: readonly string[] = ["labVarAlpha", "labVarBravo"];

/** Locator strategies the generator emits. Excludes `xpath`, which the mock fixtures do not need. */
export const GENERATABLE_LOCATOR_STRATEGIES: readonly LocatorStrategy[] = [
  "role",
  "label",
  "placeholder",
  "text",
  "testId",
  "id",
  "css",
  "tagName"
];

/**
 * A value that must never appear in any artifact. Used by the artifact scanner and by the Phase 3
 * round-trip verifier to prove the lab did not write a secret to disk.
 *
 * This is a canary, not a real credential: if it shows up in a report, the writer copied a value
 * it should have masked.
 */
export const SECRET_LEAK_CANARY = "awkit-lab-canary-must-never-be-written";
