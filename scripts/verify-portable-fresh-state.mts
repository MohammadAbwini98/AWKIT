/**
 * Portable fresh-install release gate.
 *
 * Regression guarded: a developer/runtime SQLite database must never enter app.asar or an
 * extraResources tree, and an empty security store must still require the owner to create the
 * protected Super User on first launch. This runs after `npm run build` and before manifest/signing.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SecurityKernel } from "../src/security/SecurityKernel";
import { PassthroughColumnCrypto } from "../src/security/crypto/ColumnCrypto";
import { AuthReason } from "../src/security/errors/ReasonCodes";
import { SECURITY_DB_FILENAME } from "../src/security/store/SecurityStoreSchema";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builderPath = join(repoRoot, "electron-builder.json");
const builder = JSON.parse(readFileSync(builderPath, "utf8")) as {
  files?: string[];
  extraResources?: Array<{ from?: string; filter?: string[] }>;
};

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function collectDatabaseArtifacts(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm|journal))?$/i.test(entry.name)) {
        found.push(relative(repoRoot, path).replaceAll("\\", "/"));
      }
    }
  };
  try {
    visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return found;
}

async function main(): Promise<void> {
  console.log("Portable payload freshness:");
  const fileRules = builder.files ?? [];
  check("builder uses an explicit app payload allowlist", fileRules.includes("out/**") && !fileRules.includes("**/*"));
  check(
    "builder excludes test fixtures from resources",
    (builder.extraResources ?? []).some(
      (entry) => entry.from === "resources" && (entry.filter ?? []).includes("!test-fixtures/**")
    )
  );

  const shippingRoots = [
    join(repoRoot, "out"),
    join(repoRoot, "resources"),
    join(repoRoot, "vendor"),
    join(repoRoot, "build", "native-hosts", "zvec")
  ];
  const databaseArtifacts = shippingRoots.flatMap(collectDatabaseArtifacts);
  check(
    "no mutable SQLite/database artifact exists in any packaged input tree",
    databaseArtifacts.length === 0,
    databaseArtifacts.join(", ")
  );

  const appPathsSource = readFileSync(join(repoRoot, "app", "main", "appPaths.ts"), "utf8");
  const securityBindingSource = readFileSync(join(repoRoot, "app", "main", "security", "securityKernel.ts"), "utf8");
  check(
    "mutable runtime data resolves outside packaged resources",
    appPathsSource.includes("process.env.LOCALAPPDATA") && appPathsSource.includes("RUNTIME_DATA_FOLDER")
  );
  check(
    "security database is created under the mutable runtime root",
    securityBindingSource.includes("getRuntimeDataRoot()") && securityBindingSource.includes("SECURITY_DB_FILENAME")
  );

  console.log("Fresh security database bootstrap:");
  const tempRoot = mkdtempSync(join(tmpdir(), "awkit-portable-fresh-state-"));
  const dbPath = join(tempRoot, SECURITY_DB_FILENAME);
  try {
    const kernel = await SecurityKernel.open(dbPath, new PassthroughColumnCrypto());
    check("fresh database starts unprovisioned", kernel.getBootState().provisioned === false);
    check("fresh database contains no predefined user", kernel.store.userCount() === 0);

    const first = await kernel.auth.bootstrapSuperUser({
      username: "firstowner",
      password: "Fresh!OwnerPass42",
      displayName: "First Owner"
    });
    check("first-run owner can create the protected Super User", first.ok === true);
    const users = kernel.store.listUsers();
    check(
      "bootstrap creates exactly one protected Super User",
      users.length === 1 && users[0]?.isProtectedSuperUser === true && users[0]?.roles.includes("SuperUser") === true
    );

    const second = await kernel.auth.bootstrapSuperUser({ username: "secondowner", password: "Fresh!OwnerPass43" });
    check(
      "Super User bootstrap remains one-time",
      second.ok === false && second.reason === AuthReason.ALREADY_PROVISIONED
    );
    await kernel.close();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed}/${passed + failed} portable fresh-state checks passed`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
