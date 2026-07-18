/**
 * Reproducible, offline build for the Oracle JDBC bridge.
 *
 * Compiles the zero-dependency bridge CORE with an explicitly PINNED JDK 17 (never the ambient
 * JAVA_HOME/PATH, which on dev machines is often JDK 8/11) and packages a runnable jar at
 * `oracle-jdbc-bridge/target/awkit-oracle-jdbc-bridge.jar`.
 *
 * The Oracle executor source set (`src/main/java-oracle`) is compiled ONLY when an ojdbc jar is
 * available (vendored under `resources/oracle-jdbc/lib/` or on AWKIT_ORACLE_BRIDGE_COMPILE_CLASSPATH).
 * Absent jars → the core still builds and the bridge runs against the database-free mock executor
 * (exactly how a dev checkout lacks Chromium). Specter does not use UCP.
 *
 * No network access is required or performed.
 *
 * JDK resolution order:
 *   1. AWKIT_ORACLE_BRIDGE_JDK_HOME env
 *   2. common JDK-17 install locations (Windows)
 *   3. JAVA_HOME (only if it is actually a JDK 17)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const moduleRoot = join(repoRoot, "oracle-jdbc-bridge");
const targetDir = join(moduleRoot, "target");
const classesDir = join(targetDir, "classes");
const jarPath = join(targetDir, "awkit-oracle-jdbc-bridge.jar");
const libDir = join(repoRoot, "resources", "oracle-jdbc", "lib");
const MAIN_CLASS = "com.specterstudio.oracle.bridge.Main";

const isWin = process.platform === "win32";
const exe = (name) => (isWin ? `${name}.exe` : name);

function candidateJdkHomes() {
  const list = [];
  if (process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME) list.push(process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME);
  list.push(
    "C:/Program Files/Java/jdk-17",
    "C:/Program Files/Eclipse Adoptium/jdk-17",
    "C:/Program Files/Microsoft/jdk-17",
    "/usr/lib/jvm/java-17-openjdk",
    "/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home"
  );
  if (process.env.JAVA_HOME) list.push(process.env.JAVA_HOME);
  return list;
}

function javacMajor(javacPath) {
  try {
    // javac prints e.g. "javac 17.0.8" to stdout
    const out = execFileSync(javacPath, ["-version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const m = out.match(/javac\s+(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

function resolveJdk() {
  for (const home of candidateJdkHomes()) {
    if (!home) continue;
    const javac = join(home, "bin", exe("javac"));
    const java = join(home, "bin", exe("java"));
    const jar = join(home, "bin", exe("jar"));
    if (existsSync(javac) && existsSync(java) && existsSync(jar) && javacMajor(javac) >= 17) {
      return { home, javac, java, jar };
    }
  }
  return null;
}

function listJava(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".java")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

export function buildOracleBridge({ quiet = false } = {}) {
  const log = (...a) => (quiet ? undefined : console.log(...a));
  const jdk = resolveJdk();
  if (!jdk) {
    throw new Error(
      "No JDK 17+ found. Set AWKIT_ORACLE_BRIDGE_JDK_HOME to a JDK 17 install (e.g. C:/Program Files/Java/jdk-17)."
    );
  }
  log(`[oracle-bridge] JDK: ${jdk.home}`);

  // Dev convenience: advertise the JDK this build used to the runtime resolver's dev-only fallback.
  // The resolver never auto-scans for Java — in dev it uses AWKIT_ORACLE_BRIDGE_JDK_HOME, so any
  // verifier that builds the bridge also makes that same JDK resolvable. Never runs in packaged.
  if (!process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME) process.env.AWKIT_ORACLE_BRIDGE_JDK_HOME = jdk.home;

  rmSync(classesDir, { recursive: true, force: true });
  mkdirSync(classesDir, { recursive: true });

  const coreSources = listJava(join(moduleRoot, "src", "main", "java"));
  const oracleSrcDir = join(moduleRoot, "src", "main", "java-oracle");
  const haveOracleSrc = existsSync(oracleSrcDir);

  // Compile jars come from (1) the packaged vendoring path resources/oracle-jdbc/lib and (2) an
  // explicit AWKIT_ORACLE_BRIDGE_COMPILE_CLASSPATH env (path-list) — used to compile the real
  // executors against an imported ojdbc jar WITHOUT dumping it into resources/ (which would flip the
  // dev runtime's driverExpected). The runtime classpath is assembled separately from the selected
  // Settings driver bundle.
  const sep = isWin ? ";" : ":";
  const vendoredJars =
    existsSync(libDir) ? readdirSync(libDir).filter((f) => f.endsWith(".jar")).map((f) => join(libDir, f)) : [];
  const envJars = (process.env.AWKIT_ORACLE_BRIDGE_COMPILE_CLASSPATH ?? "")
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && existsSync(s));
  const compileJars = [...new Set([...vendoredJars, ...envJars])];
  // The direct-JDBC executor references the Oracle driver ONLY via Class.forName (a string), so it has
  // no compile-time Oracle dependency and is ALWAYS compiled into the bridge jar. A user-selected ojdbc
  // driver added to the RUNTIME classpath activates it; without a driver the bridge runs the
  // database-free mock. Any ojdbc jar on the compile classpath is an optional aid only.
  const sources = [...coreSources];
  let classpath = "";
  let compileOracle = false;
  if (haveOracleSrc) {
    sources.push(...listJava(oracleSrcDir));
    classpath = compileJars.join(sep);
    compileOracle = true;
    log(`[oracle-bridge] compiling Oracle direct-JDBC executor (pure JDK; ${compileJars.length} optional compile jar(s)).`);
  }

  const argsFile = join(targetDir, "javac-args.txt");
  mkdirSync(targetDir, { recursive: true });
  // javac @argfile treats backslash as an escape char — always use forward slashes (valid on Windows).
  writeFileSync(argsFile, sources.map((s) => `"${s.replace(/\\/g, "/")}"`).join("\n"), "utf8");

  const javacArgs = ["-encoding", "UTF-8", "-d", classesDir];
  if (classpath) javacArgs.push("-classpath", classpath);
  javacArgs.push(`@${argsFile}`);
  execFileSync(jdk.javac, javacArgs, { stdio: quiet ? "pipe" : "inherit" });

  // Manifest with Main-Class (and Class-Path entries for vendored jars when present).
  const manifest = join(targetDir, "MANIFEST.MF");
  const cpLine = vendoredJars.length
    ? `Class-Path: ${vendoredJars.map((j) => `lib/${j.split(/[\\/]/).pop()}`).join(" ")}\n`
    : "";
  writeFileSync(manifest, `Manifest-Version: 1.0\nMain-Class: ${MAIN_CLASS}\n${cpLine}`, "utf8");

  execFileSync(jdk.jar, ["cfm", jarPath, manifest, "-C", classesDir, "."], { stdio: quiet ? "pipe" : "inherit" });
  log(`[oracle-bridge] built ${jarPath}`);

  return { jdk, jarPath, classesDir, mainClass: MAIN_CLASS, oracleCompiled: compileOracle };
}

// Direct invocation: `node scripts/build-oracle-bridge.mjs`
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("build-oracle-bridge.mjs")) {
  try {
    const r = buildOracleBridge();
    console.log(`[oracle-bridge] OK (oracle executor compiled: ${r.oracleCompiled}).`);
  } catch (err) {
    console.error(`[oracle-bridge] BUILD FAILED: ${err.message}`);
    process.exit(1);
  }
}
