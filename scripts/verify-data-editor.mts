/**
 * Verifies the visual JSON data-source editor's pure logic and a real file
 * read→edit→save round-trip. Run with: npx tsx scripts/verify-data-editor.mts
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  coerceCellValue,
  deriveColumns,
  displayCellValue,
  normalizeRows,
  setJsonAtPath,
  validateRowArray,
  type JsonRow
} from "@src/data/TableEditing";

let passed = 0;
let failed = 0;
function check(label: string, cond: unknown, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  console.log("Validation:");
  check("array of objects is editable", validateRowArray([{ a: 1 }, { b: 2 }]).ok);
  check("non-array rejected", !validateRowArray({ a: 1 }).ok);
  check("array with primitive rejected", !validateRowArray([{ a: 1 }, 5]).ok);
  check("array with nested array rejected", !validateRowArray([[1, 2]]).ok);

  console.log("Cell value coercion (no silent type loss):");
  check("number", coerceCellValue("42") === 42);
  check("float", coerceCellValue("3.14") === 3.14);
  check("boolean true", coerceCellValue("true") === true);
  check("boolean false", coerceCellValue("false") === false);
  check("null", coerceCellValue("null") === null);
  check("empty → empty string", coerceCellValue("") === "");
  check("quoted stays string", coerceCellValue('"123"') === "123");
  check("plain text stays string", coerceCellValue("hello") === "hello");
  check("nested object kept as JSON text", typeof coerceCellValue('{"x":1}') === "string");
  check("display null", displayCellValue(null) === "null");
  check("display number", displayCellValue(42) === "42");
  check("display object", displayCellValue({ x: 1 }) === '{"x":1}');

  console.log("Columns / normalize:");
  check("derive ordered union", eq(deriveColumns([{ id: 1, name: "a" }, { id: 2, email: "x" }]), ["id", "name", "email"]));
  check("normalize fills missing with ''", eq(normalizeRows([{ id: 1 }], ["id", "name"]), [{ id: 1, name: "" }]));

  console.log("setJsonAtPath:");
  check("root $ replaces whole document", eq(setJsonAtPath({ old: 1 }, "$", [{ a: 1 }]), [{ a: 1 }]));
  check("$.customers nests array", eq(setJsonAtPath({}, "$.customers", [{ a: 1 }]), { customers: [{ a: 1 }] }));
  check("$.a.b preserves siblings", eq(setJsonAtPath({ a: { keep: 1 }, other: 2 }, "$.a.b", [9]), { a: { keep: 1, b: [9] }, other: 2 }));

  console.log("Real file round-trip (root array):");
  const dir = await mkdtemp(join(tmpdir(), "wfs-ds-"));
  const file = join(dir, "people.json");
  const original: JsonRow[] = [
    { id: 1, name: "Mohammad", active: true },
    { id: 2, name: "Ahmad", active: false }
  ];
  await writeFile(file, `${JSON.stringify(setJsonAtPath({}, "$", original), null, 2)}\n`, "utf8");

  // read → edit a cell + add a row → save
  let data = JSON.parse(await readFile(file, "utf8")) as JsonRow[];
  data = (data as JsonRow[]).map((r) => (r.id === 2 ? { ...r, name: coerceCellValue("Ali"), active: coerceCellValue("true") } : r));
  data.push({ id: coerceCellValue("3"), name: "Sara", active: false } as JsonRow);
  await writeFile(file, `${JSON.stringify(setJsonAtPath(JSON.parse(await readFile(file, "utf8")), "$", data), null, 2)}\n`, "utf8");

  const reloaded = JSON.parse(await readFile(file, "utf8")) as JsonRow[];
  check("edited string persisted", reloaded[1].name === "Ali");
  check("edited boolean persisted as boolean", reloaded[1].active === true);
  check("added row persisted with numeric id", reloaded[2].id === 3 && reloaded[2].name === "Sara");
  check("still valid editable array", validateRowArray(reloaded).ok && reloaded.length === 3);

  console.log("Real file round-trip (nested $.customers, siblings preserved):");
  const nestedFile = join(dir, "nested.json");
  await writeFile(nestedFile, `${JSON.stringify({ meta: { v: 1 }, customers: [{ id: 1 }] }, null, 2)}\n`, "utf8");
  const nested = JSON.parse(await readFile(nestedFile, "utf8"));
  const updatedNested = setJsonAtPath(nested, "$.customers", [{ id: 1, name: "X" }, { id: 2, name: "Y" }]);
  await writeFile(nestedFile, `${JSON.stringify(updatedNested, null, 2)}\n`, "utf8");
  const reNested = JSON.parse(await readFile(nestedFile, "utf8"));
  check("nested array updated", reNested.customers.length === 2 && reNested.customers[1].name === "Y");
  check("sibling 'meta' preserved", reNested.meta?.v === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
