# awkit-oracle-jdbc-bridge

Private Java process that owns JDBC connectivity for AWKIT (SpecterStudio). AWKIT is
Electron/TypeScript; JDBC is a Java API, so Oracle access runs in this bundled bridge and talks to
the app over **framed JSON-RPC on stdin/stdout** (never a network port). See
`docs/ai/ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md` for the architecture.

## Two-tier build (offline-first)

- **Core** (`src/main/java`) — **zero external dependencies**: JSON codec, length-prefixed framing,
  request dispatch + cancellation, the read-only SQL policy, and a database-free `MockQueryExecutor`.
  It compiles and runs with a plain **JDK 17** and requires **no network**. This is what the contract
  suite (`npm run verify:oracle-bridge`) exercises — full protocol behaviour with no Oracle database.
- **Oracle executor** (`src/main/java-oracle`, added in Phase 07) — `OracleUcpQueryExecutor` using the
  Oracle JDBC Thin driver + UCP. Compiled **only when** the `ojdbc*.jar` / `ucp*.jar` are vendored
  under `resources/oracle-jdbc/lib/`. Absent jars ⇒ the bridge still starts, handshakes, health-checks
  and validates SQL, and `Main` falls back to the mock executor (mirrors a dev checkout lacking the
  bundled Chromium). Loaded reflectively so the core never hard-depends on Oracle classes.

## Build

```
npm run build:oracle-bridge      # → oracle-jdbc-bridge/target/awkit-oracle-jdbc-bridge.jar
```

The build script (`scripts/build-oracle-bridge.mjs`) pins **JDK 17** explicitly
(`AWKIT_ORACLE_BRIDGE_JDK_HOME`, else a known install, else `JAVA_HOME` only if it is a JDK 17) —
it never trusts an ambient JDK 8/11 on `PATH`.

`pom.xml` is provided for the eventual Maven build once the ojdbc/ucp/JRE are vendored and
version-locked; the offline default path is the pinned-`javac` script above.

## Protocol

- Framing: 4-byte big-endian length + UTF-8 JSON. Max frame 16 MiB.
- Envelope: `{v,id,op,params}` → `{v,id,ok,result}` or `{v,id,ok:false,error:{category,message,retriable}}`.
- Ops: `hello`, `health`, `testConnection`, `executeQuery`, `cancelQuery`, `closePool`, `shutdown`.
- stdout carries protocol bytes only; `System.out` is redirected to stderr. stderr is a **redacted**
  diagnostic channel — never a password, wallet secret, bind value, credential-bearing URL, or row.

## Licensing

Before redistribution, the vendored Oracle JDBC Thin driver, UCP, and the private Java runtime must
have their redistribution terms + required notices recorded under `resources/oracle-jdbc/LICENSES/`
(Phase 12). This module's own code is part of AWKIT.
