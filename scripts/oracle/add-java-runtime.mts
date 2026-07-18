/**
 * DEV helper: add a user-selected Java runtime into the SAME Specter-managed store the Settings UI
 * writes to (`%LOCALAPPDATA%/SpecterStudio/java-runtimes/`), validating it with a real `java -version`.
 * Mirrors the app's `addJavaRuntime` so live validation (WS-D) can resolve a runtime by id without the
 * GUI. The Java executable/home stays where it is — only metadata is recorded.
 *
 *   npx tsx scripts/oracle/add-java-runtime.mts "<name>" "<java.exe | JRE/JDK dir>"
 *
 * Prints the resulting runtime id for AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { JavaRuntimeStore, type JavaVersionProbe } from "../../src/oracle/JavaRuntimeStore";
import { parseJavaVersionOutput } from "../../src/oracle/JavaRuntimeProfile";

function probe(javaExecutablePath: string): Promise<JavaVersionProbe> {
  return new Promise((resolve) => {
    execFile(javaExecutablePath, ["-XshowSettings:properties", "-version"], { timeout: 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const parsed = parseJavaVersionOutput(`${stderr ?? ""}\n${stdout ?? ""}`);
      if (parsed.version && parsed.major) resolve({ ran: true, version: parsed.version, major: parsed.major, vendor: parsed.vendor, architecture: parsed.architecture });
      else resolve({ ran: false, reason: err ? "did not run" : "unparseable" });
    });
  });
}

async function main(): Promise<void> {
  const [name, selectedPath] = process.argv.slice(2);
  if (!name || !selectedPath) {
    console.error('Usage: npx tsx scripts/oracle/add-java-runtime.mts "<name>" "<java.exe | JRE/JDK dir>"');
    process.exit(1);
  }
  const folder = join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? process.cwd(), "SpecterStudio", "java-runtimes");
  const store = new JavaRuntimeStore({ folder, probe });
  const runtime = await store.add({ name, selectedPath });
  if (!store.getDefaultId()) store.setDefault(runtime.id);
  console.log(`Added Java runtime: id=${runtime.id} status=${runtime.status} java=${runtime.javaVersion} (${runtime.architecture})`);
  console.log(`Executable: ${runtime.javaExecutablePath}`);
  console.log(`\n$env:AWKIT_ORACLE_LIVE_JAVA_RUNTIME_PROFILE_ID = '${runtime.id}'`);
}

void main();
