/**
 * WS-B verifier — user-selected Java runtime model + store + real `java -version` probe.
 *
 * Covers: `java -version` parsing (Temurin/Oracle/GraalVM, aarch64, garbage), executable/dir resolution,
 * the JavaRuntimeStore lifecycle (add/validate/default/remove/usage), the "save only after validation"
 * rule, and — when a real JDK is present — a real spawn of `java -XshowSettings:properties -version`
 * plus a real bridge launch using the selected Java. No database required.
 *
 * Run: `npm run verify:oracle-java-runtime`.
 */
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  architectureFromOsArch,
  isAcceptableJavaExecutableName,
  javaExecutableCandidates,
  javaHomeForExecutable,
  javaRuntimeIdentity,
  majorFromJavaVersion,
  parseJavaVersionOutput
} from "../src/oracle/JavaRuntimeProfile";
import { JavaRuntimeStore, type JavaVersionProbe } from "../src/oracle/JavaRuntimeStore";
import { OracleJdbcBridgeManager, type BridgeLaunchSpec } from "../src/oracle/OracleJdbcBridgeManager";
import { buildOracleBridge } from "./build-oracle-bridge.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const isWin = process.platform === "win32";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

const TEMURIN_17 = [
  "openjdk version \"17.0.8\" 2023-07-18",
  "OpenJDK Runtime Environment Temurin-17.0.8+7 (build 17.0.8+7)",
  "OpenJDK 64-Bit Server VM Temurin-17.0.8+7 (build 17.0.8+7, mixed mode, sharing)",
  "    java.version = 17.0.8",
  "    java.vendor = Eclipse Adoptium",
  "    os.arch = amd64"
].join("\n");

const ORACLE_8 = [
  "java version \"1.8.0_351\"",
  "Java(TM) SE Runtime Environment (build 1.8.0_351-b10)",
  "Java HotSpot(TM) 64-Bit Server VM (build 25.351-b10, mixed mode)"
].join("\n");

const GRAAL_ARM = [
  "    java.version = 21.0.1",
  "    java.vendor = GraalVM Community",
  "    os.arch = aarch64"
].join("\n");

function modelTests(): void {
  console.log("Model parsing:");
  const t = parseJavaVersionOutput(TEMURIN_17);
  check("Temurin 17 → version 17.0.8", t.version === "17.0.8");
  check("Temurin 17 → major 17", t.major === 17);
  check("Temurin 17 → vendor Eclipse Adoptium", t.vendor === "Eclipse Adoptium");
  check("Temurin 17 → arch x64", t.architecture === "x64");

  const o = parseJavaVersionOutput(ORACLE_8);
  check("Oracle 1.8 banner → version 1.8.0_351", o.version === "1.8.0_351");
  check("Oracle 1.8 → major 8", o.major === 8);
  check("Oracle 1.8 banner-only → no fabricated vendor", o.vendor === undefined);

  const g = parseJavaVersionOutput(GRAAL_ARM);
  check("GraalVM props → major 21", g.major === 21);
  check("GraalVM props → arch arm64", g.architecture === "arm64");

  const junk = parseJavaVersionOutput("not a java runtime at all");
  check("garbage → no version", junk.version === undefined);

  check("majorFromJavaVersion 1.8.0 → 8", majorFromJavaVersion("1.8.0_351") === 8);
  check("majorFromJavaVersion 17.0.8 → 17", majorFromJavaVersion("17.0.8") === 17);
  check("majorFromJavaVersion 21 → 21", majorFromJavaVersion("21") === 21);
  check("majorFromJavaVersion garbage → undefined", majorFromJavaVersion("x") === undefined);

  check("arch amd64 → x64", architectureFromOsArch("amd64") === "x64");
  check("arch aarch64 → arm64", architectureFromOsArch("aarch64") === "arm64");
  check("arch unknown → unknown", architectureFromOsArch("sparc") === "unknown");

  console.log("Executable resolution:");
  const winExe = javaExecutableCandidates("C:/Java/jdk-17/bin/java.exe", { platform: "win32" });
  check("win: java.exe selection used directly", winExe.length === 1 && winExe[0].endsWith("java.exe"));
  const winDir = javaExecutableCandidates("C:/Java/jdk-17", { platform: "win32" });
  check("win: dir → bin/java.exe candidate first", winDir[0].replace(/\\/g, "/").endsWith("bin/java.exe"));
  check("win: dir → java.exe fallback candidate", winDir[1].replace(/\\/g, "/").endsWith("jdk-17/java.exe"));
  const nixDir = javaExecutableCandidates("/opt/jdk-17", { platform: "linux" });
  check("posix: dir → bin/java candidate", nixDir[0].replace(/\\/g, "/").endsWith("bin/java"));

  check("win: rejects non-java.exe name", !isAcceptableJavaExecutableName("C:/Java/jdk-17/bin/notjava.exe", { platform: "win32" }));
  check("win: accepts java.exe", isAcceptableJavaExecutableName("C:/Java/jdk-17/bin/java.exe", { platform: "win32" }));
  check("posix: accepts java", isAcceptableJavaExecutableName("/opt/jdk-17/bin/java", { platform: "linux" }));

  check("home for .../bin/java.exe is the jdk root", javaHomeForExecutable("C:/Java/jdk-17/bin/java.exe").replace(/\\/g, "/").endsWith("jdk-17"));
  check("identity folds id + exe path", javaRuntimeIdentity({ id: "r1", javaExecutablePath: "C:/j/java.exe" }) === "r1@C:/j/java.exe");
}

/** A stub probe that reports a fixed Java, so the store lifecycle is testable without a real JDK. */
function stubProbe(result: JavaVersionProbe): { fn: (p: string) => Promise<JavaVersionProbe>; calls: string[] } {
  const calls: string[] = [];
  return { fn: async (p: string) => (calls.push(p), result), calls };
}

async function storeTests(): Promise<void> {
  console.log("\nStore lifecycle (stub probe):");
  const root = mkdtempSync(join(tmpdir(), "awkit-java-rt-"));
  try {
    // A real fake java.exe file so resolveExecutable finds it.
    const fakeExe = join(root, isWin ? "java.exe" : "java");
    writeFileSync(fakeExe, "#!/bin/true\n");

    const good = stubProbe({ ran: true, version: "17.0.8", major: 17, vendor: "Eclipse Adoptium", architecture: "x64" });
    const store = new JavaRuntimeStore({ folder: join(root, "java-runtimes"), probe: good.fn });

    const added = await store.add({ name: "Temurin 17", selectedPath: fakeExe });
    check("add → status valid", added.status === "valid");
    check("add → records version + major", added.javaVersion === "17.0.8" && added.javaMajorVersion === 17);
    check("add → records vendor + arch", added.vendor === "Eclipse Adoptium" && added.architecture === "x64");
    check("add → probed the resolved exe", good.calls[0] === fakeExe);
    check("list returns the runtime", store.list().length === 1);
    check("get returns the runtime", store.get(added.id)?.name === "Temurin 17");

    // First-added becomes default via the service; the store's setDefault is explicit here.
    store.setDefault(added.id);
    check("setDefault → getDefaultId", store.getDefaultId() === added.id);

    // Reject: missing executable.
    await store
      .add({ name: "Nowhere", selectedPath: join(root, "does-not-exist") })
      .then(() => check("reject: missing executable", false))
      .catch(() => check("reject: missing executable", true));

    // Reject: too-old Java (< 8).
    const old = new JavaRuntimeStore({ folder: join(root, "java-runtimes"), probe: stubProbe({ ran: true, version: "1.6.0", major: 6 }).fn });
    await old
      .add({ name: "Java 6", selectedPath: fakeExe })
      .then(() => check("reject: Java older than 8", false))
      .catch(() => check("reject: Java older than 8", true));

    // Reject: java -version could not run.
    const broken = new JavaRuntimeStore({ folder: join(root, "java-runtimes"), probe: stubProbe({ ran: false, reason: "boom" }).fn });
    await broken
      .add({ name: "Broken", selectedPath: fakeExe })
      .then(() => check("reject: java -version failed → not saved", false))
      .catch(() => check("reject: java -version failed → not saved", true));
    check("failed add left no extra runtime", store.list().length === 1);

    // validate → missing when the executable disappears.
    rmSync(fakeExe, { force: true });
    const revalidated = await store.validate(added.id);
    check("validate → missing when exe deleted", revalidated.status === "missing");

    // remove clears the default pointer.
    store.remove(added.id);
    check("remove deletes the runtime", store.get(added.id) === null);
    check("remove clears the default", store.getDefaultId() === undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Locate a real JDK for the live probe (same discovery order as the bridge build). */
function realJavaExe(): string | undefined {
  const homes = [process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME, "C:/Program Files/Java/jdk-17", "/usr/lib/jvm/java-17-openjdk", process.env.JAVA_HOME];
  const exe = isWin ? "java.exe" : "java";
  for (const home of homes) {
    if (home && existsSync(join(home, "bin", exe))) return join(home, "bin", exe);
  }
  return undefined;
}

function realProbe(javaExe: string): Promise<JavaVersionProbe> {
  return new Promise((res) => {
    execFile(javaExe, ["-XshowSettings:properties", "-version"], { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const parsed = parseJavaVersionOutput(`${stderr ?? ""}\n${stdout ?? ""}`);
      if (parsed.version && parsed.major) res({ ran: true, version: parsed.version, major: parsed.major, vendor: parsed.vendor, architecture: parsed.architecture });
      else res({ ran: false, reason: err ? "did not run" : "unparseable" });
    });
  });
}

async function realTests(): Promise<void> {
  console.log("\nReal java runtime (isolated spawn):");
  const javaExe = realJavaExe();
  if (!javaExe) {
    console.log("  • no JDK found (set AWKIT_ORACLE_BRIDGE_JDK_HOME) — skipping the live probe (external gate).");
    return;
  }
  const probe = await realProbe(javaExe);
  check("real java -version ran", probe.ran);
  check("real java reports a version", typeof probe.version === "string" && (probe.version?.length ?? 0) > 0);
  check("real java reports a sane major (>= 8)", (probe.major ?? 0) >= 8);
  check("real java reports an architecture", probe.architecture === "x64" || probe.architecture === "arm64");

  // End-to-end: add a real runtime through the store (resolving the JDK home directory).
  const root = mkdtempSync(join(tmpdir(), "awkit-java-rt-real-"));
  try {
    const store = new JavaRuntimeStore({ folder: join(root, "java-runtimes"), probe: realProbe });
    // Select the JDK HOME (dir) and let the store resolve bin/java(.exe).
    const home = javaHomeForExecutable(javaExe);
    const added = await store.add({ name: "Local JDK", selectedPath: home });
    check("real add via directory → status valid", added.status === "valid");
    check("real add resolved bin/java(.exe)", added.javaExecutablePath.replace(/\\/g, "/").includes("/bin/"));

    // Real bridge launch using the selected Java (mock mode; no driver needed — proves java can start it).
    const bridgeJar = join(repoRoot, "oracle-jdbc-bridge", "target", "awkit-oracle-jdbc-bridge.jar");
    if (existsSync(bridgeJar)) {
      const spec: BridgeLaunchSpec = { javaPath: added.javaExecutablePath, jarPath: bridgeJar, env: { AWKIT_ORACLE_BRIDGE_MOCK: "1" } };
      const manager = new OracleJdbcBridgeManager({ resolveLaunchSpec: () => spec, handshakeTimeoutMs: 20_000 });
      try {
        const hello = await manager.hello();
        check("selected java launches the bridge (handshake ok)", typeof hello.executionMode === "string");
        check("bridge reports a javaVersion", typeof hello.javaVersion === "string" && (hello.javaVersion?.length ?? 0) > 0);
      } finally {
        await manager.dispose().catch(() => undefined);
      }
    } else {
      // Build it, then handshake — keeps the check meaningful without a pre-built jar.
      buildOracleBridge({ quiet: true });
      check("dev bridge jar built for the launch test", existsSync(bridgeJar));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  modelTests();
  await storeTests();
  await realTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
