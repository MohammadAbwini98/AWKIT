# Oracle JDBC Runtime — User-Selected Java + Driver (Compatibility & Setup)

**Specter does not bundle Java or UCP.** Oracle live queries run through Specter's own isolated **bridge
jar** (the only Oracle artifact that ships) using **direct JDBC** (`DriverManager`, one connection per
query — no connection pool). Both the **Java runtime** and the **Oracle JDBC driver** are **selected by the
user in Settings → Database Drivers** and are never vendored into the app. Non-Oracle workflows, JSON data
sources, and Oracle **Snapshot** Data Sources never need Java at all.

The path is: `Settings → selected java.exe → isolated bridge → imported ojdbc*.jar → Oracle`.

This replaces the former "private jlink'd JRE + vendored ojdbc/ucp jars" model. UCP (Universal Connection
Pool) is **removed entirely** — importing a `ucp*.jar` is rejected.

## 1. What the user configures (Settings → Database Drivers)

| Item | How | Notes |
|---|---|---|
| **Java runtime** | "Java Runtime for Database Drivers" → *Select java.exe…* or *Select JRE/JDK folder…* | Any installed JRE/JDK, **Java 8+**. Specter records only its path + probed version/vendor/arch and launches it in a child process (`java -version`, then the bridge). Never system Java / `JAVA_HOME` / `PATH` auto-scan. |
| **Oracle JDBC driver** | "Oracle JDBC Drivers" → *Import driver bundle…* (an `ojdbc*.jar`) | Copied into managed storage (`%LOCALAPPDATA%/SpecterStudio/oracle-drivers/<id>/`), hashed, and load-tested in the isolated bridge. Companion jars (`oraclepki`, `osdt_core`, `osdt_cert`, `ons`, `simplefan`) are kept for wallet/TCPS. A `ucp*.jar` is **rejected** ("UCP is no longer supported"). |
| **Per-profile selection** | Each Oracle connection profile may name a `javaRuntimeProfileId` + `driverBundleId` | Absent ⇒ the app-wide default runtime/bundle. Different Java/driver combinations run in **separate** bridge processes (folded into the compatibility key). |

## 2. Java ⇄ JDBC compatibility

The driver's required Java feature-version is derived from the ojdbc filename (`ojdbc8 ⇒ 8`, `ojdbc11 ⇒ 11`,
`ojdbc17 ⇒ 17`) and cross-checked against the JAR's class-file version and a real bridge load test. Statuses
surfaced in Settings: **Valid**, **Compatible-but-unverified**, **Incompatible**, **Missing**,
**Validation-failed**. A driver whose required Java major exceeds the selected runtime is **incompatible**
and rejected as a default. (Example: `ojdbc17` needs Java 17+; selecting a Java 11 runtime is incompatible.)

Validated locally: `ojdbc17.jar` 23.26.2.0.0 (JDBC-only) + Eclipse-equivalent **Oracle JDK 17.0.8 (x64)** →
**Valid**, real handshake + real query against Oracle 19c.

## 3. Supported databases & TLS

- **Oracle Database**: 19c, 21c, 23ai (per the imported driver's support matrix).
- **TLS / wallet**: Thin-driver TLS (TCPS) with optional Oracle Wallet. The wallet path is supplied **per
  connection profile** at runtime — wallets are never bundled and never committed.

## 4. What Specter bundles (the bridge, and only the bridge)

The only Oracle artifact in a packaged build is Specter's own tiny bridge jar, staged by
`npm run prepare:oracle-runtime`:

```text
resources/oracle-jdbc/
├── bridge/awkit-oracle-jdbc-bridge.jar   # Specter's own code, built reproducibly (pinned JDK 17)
├── manifest.json                          # resolved from scripts/oracle/oracle-runtime.manifest.json
└── checksums.json                         # sha256 over the staged tree (integrity gate)
```

There is **no** `runtime/` (private JRE) and **no** `lib/` (driver jars). The offline validator
(`npm run validate:offline`) and `verify:oracle-offline-bundle` **fail** if a JRE or driver jar ever
appears in the bundle, and the whole `resources/oracle-jdbc/` tree is gitignored (generated, never
committed).

## 5. Reproducible preparation

```text
npm run build:oracle-bridge          # compile the bridge with a pinned JDK 17 (pure JDK; no UCP)
npm run prepare:oracle-runtime       # build + stage the bridge jar, write manifest.json + checksums.json
npm run verify:oracle-runtime-prep   # unit-test the preparation logic (synthetic fixtures) — 14 checks
```

Preparation is deterministic (same bridge jar ⇒ same `checksums.json`) and **fails closed** on a wrong
architecture or a missing bridge jar. No network, no out-of-band artifacts to acquire — the bridge is built
from this repo's own source.

## 6. Licensing

Specter bundles only its own bridge jar (this repo's source) — there is **no** third-party Oracle driver or
JRE redistribution, so no Oracle OTN / Temurin license notice needs shipping. The user supplies their own
licensed Java runtime and Oracle JDBC driver, obtained from a source they are authorized to use.

## 7. Definition of done

- [x] User selects Java (`java.exe`/JDK dir) + imports an ojdbc jar in Settings; UCP import rejected.
- [x] Java ⇄ JDBC compatibility validated (filename major + class-file version + real bridge load test).
- [x] Only the bridge jar is bundled; no private JRE, no vendored driver; offline validator enforces it.
- [x] `prepare:oracle-runtime` builds + stages the bridge and regenerates `checksums.json`, fail-closed.
- [x] `verify:oracle-runtime-prep` covers happy path, missing bridge jar, wrong architecture, repeatability.
- [x] Live-validated against real Oracle 19c via the Settings path (`ojdbc17` 23.26.2.0.0 + JDK 17.0.8).
