/**
 * Mock-UI Oracle fixture checks.
 *
 * The mock-UI fixture exists in two places that must not drift apart:
 *   - `scripts/oracle/local-19c-mock-ui-fixture.sql` → SPECTER_MOCKUI.MOCK_FORM_CASES (real Oracle)
 *   - `MockFormCasesFixture` (database-free, served by the bridge's mock executor)
 * …and it is only useful if its values are things the Feature Test Lab form at `/form` can actually
 * accept. This verifier asserts all three edges WITHOUT a database:
 *
 *   1. Parity  — the rows the mock bridge returns match the SQL fixture's INSERT literals.
 *   2. UI fit  — every mapped column has a real control on `/form`, and every select/radio value in
 *                the fixture is a real option (the check that catches drift when the page changes).
 *   3. Contract— the workflow SQL passes the read-only policy, and maxRows still truncates.
 *
 * Run: `npm run verify:oracle-mock-ui`.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { validateReadOnlySql } from "../src/oracle/OracleSqlPolicy";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE_SQL = resolve(repoRoot, "scripts/oracle/local-19c-mock-ui-fixture.sql");
const FORM_HTML = resolve(repoRoot, "mock-site/public/form.html");

/** The statement a mock-UI workflow runs. Identical against real Oracle and the mock bridge. */
const WORKFLOW_SQL =
  "SELECT case_id, case_label, first_name, last_name, email, age, salary, birth_date, country, " +
  "account_type, skills, description, gender, interest_automation, interest_testing, accept_terms, " +
  "expected_outcome FROM SPECTER_MOCKUI.MOCK_FORM_CASES ORDER BY case_id";

/** Column → the `/form` control it drives. Asserted against the real page, not assumed. */
const COLUMN_TO_CONTROL: Record<string, string> = {
  FIRST_NAME: "firstName",
  LAST_NAME: "lastName",
  EMAIL: "email",
  AGE: "age",
  SALARY: "salary",
  BIRTH_DATE: "birthDate",
  COUNTRY: "country",
  ACCOUNT_TYPE: "accountType",
  SKILLS: "skills",
  DESCRIPTION: "description",
  INTEREST_AUTOMATION: "interestAutomation",
  INTEREST_TESTING: "interestTesting",
  ACCEPT_TERMS: "acceptTerms"
};

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── SQL fixture parsing ──────────────────────────────────────────────────────

type Literal = string | number | null | { date: string };

/** Split one INSERT's VALUES list, honoring '' escapes so `O''Brien` stays a single value. */
function splitValues(list: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inString = false;
  for (let i = 0; i < list.length; i += 1) {
    const c = list[i];
    if (inString) {
      if (c === "'" && list[i + 1] === "'") {
        buf += "''";
        i += 1;
        continue;
      }
      if (c === "'") {
        inString = false;
        buf += c;
        continue;
      }
      buf += c;
      continue;
    }
    if (c === "'") {
      inString = true;
      buf += c;
      continue;
    }
    if (c === ",") {
      out.push(buf.trim());
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseLiteral(raw: string): Literal {
  const token = raw.trim();
  if (/^NULL$/i.test(token)) return null;
  const dateMatch = /^DATE\s+'(\d{4})-(\d{2})-(\d{2})'$/i.exec(token);
  if (dateMatch) return { date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` };
  if (token.startsWith("'")) return token.slice(1, -1).replace(/''/g, "'");
  const num = Number(token);
  if (!Number.isNaN(num)) return num;
  throw new Error(`unrecognized SQL literal: ${token}`);
}

function parseFixtureRows(sql: string): Literal[][] {
  const rows: Literal[][] = [];
  const re = /INSERT INTO SPECTER_MOCKUI\.MOCK_FORM_CASES VALUES \(([\s\S]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) rows.push(splitValues(m[1]).map(parseLiteral));
  return rows;
}

/** Mirror of the real DATE→JSON conversion (Timestamp at local midnight → Instant). */
function dateToInstant(ymd: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(y, mo - 1, d).toISOString().replace(/\.000Z$/, "Z");
}

/** Compare a mock JSON value against the SQL literal it came from. */
function valuesAgree(mock: unknown, literal: Literal): boolean {
  if (literal === null) return mock === null;
  if (typeof literal === "object") return typeof mock === "string" && mock === dateToInstant(literal.date);
  if (typeof literal === "number") return Number(mock) === literal; // NUMBER(p,2) arrives as a string
  return mock === literal;
}

// ── /form parsing ────────────────────────────────────────────────────────────

function formControlIds(html: string): Set<string> {
  const ids = new Set<string>();
  const re = /<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return ids;
}

function selectOptions(html: string, selectId: string): string[] {
  const block = new RegExp(`<select\\b[^>]*\\bid="${selectId}"[\\s\\S]*?</select>`).exec(html);
  if (!block) return [];
  return Array.from(block[0].matchAll(/<option value="([^"]*)"/g)).map((m) => m[1]);
}

function radioValues(html: string, name: string): string[] {
  const re = new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*\\bvalue="([^"]*)"`, "g");
  return Array.from(html.matchAll(re)).map((m) => m[1]);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Fixture sources present:");
  check("SQL fixture exists", existsSync(FIXTURE_SQL));
  check("/form page exists", existsSync(FORM_HTML));
  if (failed > 0) {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(1);
  }

  const sqlText = readFileSync(FIXTURE_SQL, "utf8");
  const html = readFileSync(FORM_HTML, "utf8");
  const sqlRows = parseFixtureRows(sqlText);

  console.log("\nSQL fixture shape:");
  check("8 fixture rows parsed", sqlRows.length === 8, `parsed ${sqlRows.length}`);
  check("every row has 17 columns", sqlRows.every((r) => r.length === 17));
  check("fixture never hardcodes a credential", !/IDENTIFIED BY/i.test(sqlText));
  check("fixture is deterministic (no SYSDATE/SYSTIMESTAMP in the rows)", !/INSERT[\s\S]*?SYS(DATE|TIMESTAMP)/i.test(sqlText));

  console.log("\nRead-only SQL policy:");
  const policy = validateReadOnlySql(WORKFLOW_SQL);
  check("workflow SELECT is allowed", policy.allowed, policy.reason);
  check("a write against the fixture is rejected", !validateReadOnlySql("DELETE FROM SPECTER_MOCKUI.MOCK_FORM_CASES").allowed);

  console.log("\nColumns map onto real /form controls:");
  const ids = formControlIds(html);
  for (const [column, controlId] of Object.entries(COLUMN_TO_CONTROL)) {
    check(`${column} → #${controlId} exists on /form`, ids.has(controlId));
  }
  check("GENDER → radio group exists", radioValues(html, "gender").length > 0);

  console.log("\nFixture values are valid /form options:");
  const countries = new Set(selectOptions(html, "country"));
  const accountTypes = new Set(selectOptions(html, "accountType"));
  const skills = new Set(selectOptions(html, "skills"));
  const genders = new Set(radioValues(html, "gender"));
  const colIndex = (name: string) => [
    "CASE_ID", "CASE_LABEL", "FIRST_NAME", "LAST_NAME", "EMAIL", "AGE", "SALARY", "BIRTH_DATE",
    "COUNTRY", "ACCOUNT_TYPE", "SKILLS", "DESCRIPTION", "GENDER", "INTEREST_AUTOMATION",
    "INTEREST_TESTING", "ACCEPT_TERMS", "EXPECTED_OUTCOME"
  ].indexOf(name);

  let badOption: string | undefined;
  for (const row of sqlRows) {
    const label = String(row[colIndex("CASE_LABEL")]);
    const country = row[colIndex("COUNTRY")];
    const accountType = row[colIndex("ACCOUNT_TYPE")];
    const gender = row[colIndex("GENDER")];
    const rowSkills = String(row[colIndex("SKILLS")] ?? "").split(",").filter(Boolean);
    if (typeof country === "string" && !countries.has(country)) badOption ??= `${label}: country ${country}`;
    if (typeof accountType === "string" && !accountTypes.has(accountType)) badOption ??= `${label}: accountType ${accountType}`;
    if (typeof gender === "string" && !genders.has(gender)) badOption ??= `${label}: gender ${gender}`;
    for (const s of rowSkills) if (!skills.has(s)) badOption ??= `${label}: skill ${s}`;
  }
  check("every country / accountType / skill / gender is a real option", badOption === undefined, badOption);

  const checkboxCols = ["INTEREST_AUTOMATION", "INTEREST_TESTING", "ACCEPT_TERMS"];
  check(
    "checkbox columns are strictly 0 or 1",
    sqlRows.every((r) => checkboxCols.every((c) => r[colIndex(c)] === 0 || r[colIndex(c)] === 1))
  );
  check(
    "the negative case is the only one declining terms",
    sqlRows.filter((r) => r[colIndex("ACCEPT_TERMS")] === 0).length === 1 &&
      sqlRows.filter((r) => r[colIndex("EXPECTED_OUTCOME")] === "BLOCKED").length === 1
  );
  check("edge cases are covered (a NULL date, a NULL gender, a NULL optional text)",
    sqlRows.some((r) => r[colIndex("BIRTH_DATE")] === null) &&
    sqlRows.some((r) => r[colIndex("GENDER")] === null) &&
    sqlRows.some((r) => r[colIndex("LAST_NAME")] === null));

  console.log("\nBuilding bridge jar (pinned JDK 17)…");
  const build = buildOracleBridge({ quiet: true });
  check("bridge jar exists after build", existsSync(build.jarPath));

  const launchSpec: BridgeLaunchSpec = {
    javaPath: build.jdk.java,
    jarPath: build.jarPath,
    env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" }
  };
  const manager = new OracleJdbcBridgeManager({
    resolveLaunchSpec: () => launchSpec,
    handshakeTimeoutMs: 20_000
  });

  try {
    console.log("\nDatabase-free fixture served by the mock bridge:");
    const result = (await manager.call("executeQuery", { sql: WORKFLOW_SQL, maxRows: 100 })) as {
      rows: Array<Record<string, unknown>>;
      columns: Array<{ name: string; jdbcType: string }>;
      rowCount: number;
      truncated: boolean;
    };
    check("mock serves the mock-UI fixture, not the generic shape", result.columns.length === 17);
    check("row count matches the SQL fixture", result.rowCount === sqlRows.length);
    check("not truncated at maxRows=100", result.truncated === false);
    check(
      "column names match the table definition",
      result.columns.map((c) => c.name).join(",") ===
        ["CASE_ID","CASE_LABEL","FIRST_NAME","LAST_NAME","EMAIL","AGE","SALARY","BIRTH_DATE","COUNTRY","ACCOUNT_TYPE","SKILLS","DESCRIPTION","GENDER","INTEREST_AUTOMATION","INTEREST_TESTING","ACCEPT_TERMS","EXPECTED_OUTCOME"].join(",")
    );

    console.log("\nParity — mock rows vs SQL fixture literals:");
    let mismatch: string | undefined;
    for (let r = 0; r < sqlRows.length; r += 1) {
      const mockRow = result.rows[r];
      for (let c = 0; c < result.columns.length; c += 1) {
        const column = result.columns[c].name;
        if (!valuesAgree(mockRow?.[column], sqlRows[r][c])) {
          mismatch ??= `row ${r + 1} column ${column}: mock=${JSON.stringify(mockRow?.[column])} sql=${JSON.stringify(sqlRows[r][c])}`;
        }
      }
    }
    check("every value agrees with the SQL fixture", mismatch === undefined, mismatch);

    check(
      "NUMBER(12,2) salary arrives as a 2-decimal string (real-JDBC shape)",
      typeof result.rows[0].SALARY === "string" && /^\d+\.\d{2}$/.test(String(result.rows[0].SALARY))
    );
    check("NULLs stay null (never the string \"null\")", result.rows[1].LAST_NAME === null && result.rows[3].BIRTH_DATE === null);

    console.log("\nLimits still apply on the fixture path:");
    const truncated = (await manager.call("executeQuery", { sql: WORKFLOW_SQL, maxRows: 3 })) as {
      rowCount: number;
      truncated: boolean;
    };
    check("maxRows truncates the fixture", truncated.rowCount === 3 && truncated.truncated === true);
  } finally {
    await manager.dispose();
  }
  check("bridge disposed cleanly", !manager.isRunning());

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
