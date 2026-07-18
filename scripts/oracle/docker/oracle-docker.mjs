/**
 * DEVELOPMENT-ONLY helper for running Oracle Database Free in Docker for Specter's live Oracle
 * validation (Phases 02–04 of the Docker & JDBC Driver Settings plan). Docker is a **local dev
 * dependency only** — it is NEVER a Specter production/runtime dependency, and nothing here is bundled
 * into the packaged app.
 *
 * Subcommands: pull | start | stop | logs | status | reset | fixture
 *   node scripts/oracle/docker/oracle-docker.mjs <subcommand>
 *
 * The admin password comes from the environment (never hardcoded / committed):
 *   $env:SPECTER_ORACLE_ADMIN_PASSWORD  (required for `start` and `fixture`)
 *
 * Target after `start`:
 *   Host localhost  Port 1521  PDB FREEPDB1
 *   JDBC jdbc:oracle:thin:@//localhost:1521/FREEPDB1
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the docker binary. A freshly-installed Docker Desktop updates the machine PATH, but shells
 * started before the install still have the old PATH — so fall back to the known Windows install path.
 */
function resolveDocker() {
  const probe = spawnSync("docker", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return "docker";
  const candidates = [
    join(process.env.ProgramFiles ?? "C:/Program Files", "Docker", "Docker", "resources", "bin", "docker.exe"),
    join(process.env.ProgramW6432 ?? "C:/Program Files", "Docker", "Docker", "resources", "bin", "docker.exe")
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return "docker";
}
const DOCKER = resolveDocker();

/**
 * The docker CLI shells out to its credential helper (`docker-credential-desktop`), which must be on
 * PATH. A shell started before Docker's install has a stale PATH — so inject Docker's bin dir into the
 * child environment for every docker call.
 */
function dockerEnv() {
  const env = { ...process.env };
  if (DOCKER !== "docker") {
    const binDir = resolve(DOCKER, "..");
    const sep = process.platform === "win32" ? ";" : ":";
    env.PATH = `${binDir}${sep}${env.PATH ?? ""}`;
    env.Path = env.PATH;
  }
  return env;
}

const IMAGE = "container-registry.oracle.com/database/free:latest";
const CONTAINER = "specter-oracle";
const VOLUME = "specter-oracle-data";
const PORT = "1521";
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function docker(args, opts = {}) {
  return execFileSync(DOCKER, args, { encoding: "utf8", stdio: opts.inherit ? "inherit" : "pipe", env: dockerEnv(), ...opts });
}

function dockerQuiet(args) {
  const r = spawnSync(DOCKER, args, { encoding: "utf8", env: dockerEnv() });
  return { code: r.status ?? 1, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

function requireDocker() {
  const r = dockerQuiet(["info", "--format", "{{.OSType}}"]);
  if (r.code !== 0) {
    console.error("Docker engine is not available. Start Docker Desktop and ensure `docker info` succeeds.");
    process.exit(1);
  }
  const osType = r.out.trim();
  if (osType && osType !== "linux") {
    console.error(`Docker is in '${osType}'-container mode. Switch to LINUX containers for the Oracle image.`);
    process.exit(1);
  }
}

function containerState() {
  const r = dockerQuiet(["inspect", "-f", "{{.State.Status}}|{{.State.Health.Status}}", CONTAINER]);
  if (r.code !== 0) return { exists: false, status: "absent", health: "none" };
  const [status, health] = r.out.trim().split("|");
  return { exists: true, status, health: health || "none" };
}

function adminPassword() {
  const pw = process.env.SPECTER_ORACLE_ADMIN_PASSWORD;
  if (!pw) {
    console.error("Set $env:SPECTER_ORACLE_ADMIN_PASSWORD (an admin password for the local, non-prod container).");
    process.exit(1);
  }
  return pw;
}

function pull() {
  requireDocker();
  console.log(`Pulling ${IMAGE} (large, several minutes) …`);
  docker(["pull", IMAGE], { inherit: true });
}

function start() {
  requireDocker();
  const pw = adminPassword();
  const st = containerState();
  if (st.exists && st.status === "running") {
    console.log(`Container ${CONTAINER} already running.`);
    return waitHealthy();
  }
  if (st.exists) {
    console.log(`Starting existing container ${CONTAINER} …`);
    docker(["start", CONTAINER]);
    return waitHealthy();
  }
  dockerQuiet(["volume", "create", VOLUME]);
  console.log(`Running ${CONTAINER} from ${IMAGE} …`);
  docker([
    "run", "-d",
    "--name", CONTAINER,
    "-p", `${PORT}:1521`,
    "-e", `ORACLE_PWD=${pw}`,
    "-v", `${VOLUME}:/opt/oracle/oradata`,
    IMAGE
  ]);
  waitHealthy();
}

function waitHealthy() {
  console.log("Waiting for the database to become healthy (first run initializes the DB — can take minutes)…");
  const deadline = Date.now() + 15 * 60 * 1000;
  let last = "";
  while (Date.now() < deadline) {
    const st = containerState();
    if (!st.exists) {
      console.error("Container disappeared. Check `oracle:docker:logs`.");
      process.exit(1);
    }
    if (st.status !== "running") {
      console.error(`Container is '${st.status}'. Check oracle:docker:logs.`);
      process.exit(1);
    }
    if (st.health === "healthy") {
      console.log("Database is healthy.");
      console.log("JDBC: jdbc:oracle:thin:@//localhost:1521/FREEPDB1");
      return;
    }
    if (st.health !== last) {
      console.log(`  health: ${st.health} …`);
      last = st.health;
    }
    sleep(5000);
  }
  console.error("Timed out waiting for health. Inspect `oracle:docker:logs`.");
  process.exit(1);
}

function stop() {
  const st = containerState();
  if (!st.exists) return console.log("No container to stop.");
  docker(["stop", CONTAINER]);
  console.log("Stopped.");
}

function logs() {
  if (!containerState().exists) return console.log("No container.");
  docker(["logs", "--tail", "80", CONTAINER], { inherit: true });
}

function status() {
  const st = containerState();
  console.log(`container: ${st.exists ? st.status : "absent"}   health: ${st.health}`);
  if (st.exists) docker(["ps", "--filter", `name=${CONTAINER}`, "--format", "  {{.Names}}  {{.Status}}  {{.Ports}}"], { inherit: true });
}

function reset() {
  dockerQuiet(["rm", "-f", CONTAINER]);
  dockerQuiet(["volume", "rm", VOLUME]);
  console.log(`Removed container ${CONTAINER} and volume ${VOLUME}.`);
}

/** Provision the fixture schema + least-privilege read-only account via sqlplus inside the container. */
function fixture() {
  requireDocker();
  const st = containerState();
  if (!st.exists || st.status !== "running" || st.health !== "healthy") {
    console.error("Container is not healthy. Run `oracle:docker:start` first.");
    process.exit(1);
  }
  const adminPw = adminPassword();
  const roPw = process.env.SPECTER_ORACLE_RO_PASSWORD;
  if (!roPw) {
    console.error("Set $env:SPECTER_ORACLE_RO_PASSWORD (password for the read-only Specter account).");
    process.exit(1);
  }
  const sqlPath = join(repoRoot, "scripts", "oracle", "docker", "provision-fixture.sql");
  // Feed the provisioning SQL to sqlplus as SYSDBA inside FREEPDB1, substituting the RO password.
  const provisionSql = readAndSubstitute(sqlPath, roPw);
  const conn = `sys/${adminPw}@localhost:1521/FREEPDB1 as sysdba`;
  console.log("Provisioning fixture + read-only account inside the container …");
  const r = spawnSync(DOCKER, ["exec", "-i", CONTAINER, "sqlplus", "-S", "-L", conn], {
    input: provisionSql,
    encoding: "utf8",
    env: dockerEnv()
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // Redact the RO password if it ever appears in echoed output.
  console.log(out.split(roPw).join("***"));
  if (r.status !== 0 || /ORA-\d+/.test(out.replace(/ORA-01920|ORA-00955|ORA-01921/g, ""))) {
    // ORA-00955/01920/01921 = object/user already exists — tolerated on re-run.
    console.error("Provisioning reported errors (see output above; pre-existing-object errors are OK on re-run).");
  } else {
    console.log("Fixture + read-only account provisioned.");
  }
}

function readAndSubstitute(path, roPw) {
  return readFileSync(path, "utf8").replaceAll("__RO_PASSWORD__", roPw);
}

function sleep(ms) {
  // Real blocking sleep (no busy-wait) so the multi-minute health poll doesn't peg a CPU core.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const sub = process.argv[2];
const commands = { pull, start, stop, logs, status, reset, fixture };
if (!sub || !commands[sub]) {
  console.error(`Usage: node scripts/oracle/docker/oracle-docker.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(1);
}
commands[sub]();
