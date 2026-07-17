# Oracle JDBC Private Runtime — Compatibility, Licensing & Acquisition (Phase 02)

This document locks the inputs required to compile and package the **real** Oracle JDBC/UCP executor
into AWKIT's private, offline Java runtime. It is the human-readable companion to the machine-readable
manifest at [`scripts/oracle/oracle-runtime.manifest.json`](../../scripts/oracle/oracle-runtime.manifest.json),
which is what `npm run prepare:oracle-runtime` actually consumes.

> **Why values are marked "confirm at vendoring time".** Build-time network access is blocked in the
> development environment, so the real `ojdbc`/`ucp` jars and a private JRE cannot be downloaded or
> hashed here. Exact versions, SHA-256 hashes, and license text MUST be filled in from the official
> vendor artifacts when the bundle is first cut. The manifest carries empty `sha256` fields precisely
> so the preparation step fails closed until they are populated.

## 1. Compatibility matrix

| Component | Locked choice | Notes / confirm at vendoring time |
|---|---|---|
| Bundled Java runtime | Eclipse Temurin (or equivalent redistribution-permitted OpenJDK), **feature 17** | jlink-trimmed private JRE staged at `resources/oracle-jdbc/runtime/`. Never system Java. |
| Bridge bytecode target | **17** | `scripts/build-oracle-bridge.mjs` pins JDK 17; matches the bundled JRE. |
| Oracle JDBC | `ojdbc11.jar` | The `ojdbc11` build targets JDK 11+/17; record the **exact** release (e.g. 23.x) actually vendored. |
| Oracle UCP | `ucp11.jar` | Must match the ojdbc release train. |
| Companion jars | record if the chosen release requires any | e.g. `oraclepki`/`osdt_*` only if wallet/PKI features are enabled. Add to the manifest `artifacts` if so. |
| Supported Oracle Database | 19c, 21c, 23ai | Confirm against the Oracle JDBC support matrix for the vendored driver version. |
| Windows architecture | **x64** | The manifest `platform.arch` is enforced by the preparation step. |
| TLS / wallet scope | Thin-driver TLS (TCPS) + optional Oracle Wallet | Wallet path is supplied per connection profile at runtime; **wallets are never bundled**. |

## 2. Approved acquisition

Artifacts are acquired **out-of-band** (no runtime or build-time downloads are ever added to AWKIT) from
one authorized source, then placed in a local staging directory for `prepare:oracle-runtime`:

- an internal artifact repository (preferred), **or**
- the official vendor download (Oracle OTN / Maven Central for the driver; the JRE vendor's download), **or**
- a secure, hash-pinned build cache.

Staging directory (default `./oracle-runtime-src`, overridable with `AWKIT_ORACLE_RUNTIME_SRC`):

```text
oracle-runtime-src/
├── runtime/                 # private JRE tree (bin/java.exe, lib/, ...)
├── ojdbc11.jar
├── ucp11.jar
├── ORACLE-LICENSE.txt       # required notice for ojdbc/ucp
└── JRE-LICENSE.txt          # required notice(s) for the JRE
```

`prepare:oracle-runtime` **verifies checksums, validates architecture and Java version, stages** the
artifacts under `resources/oracle-jdbc/`, builds the bridge, and **regenerates `checksums.json`**. It
never trusts an arbitrary `JAVA_HOME`/`PATH`, and it never reaches the network.

## 3. Licensing review (confirm exact terms at vendoring time)

- **Oracle JDBC / UCP** — redistribution is governed by the license shipped with the specific driver
  release (historically the OTN License; more recent drivers are published under the Oracle Free Use
  Terms and Conditions and mirrored to Maven Central). Confirm the exact terms for the vendored version,
  include the required notice as `ORACLE-LICENSE.txt`, and retain any attribution text the license
  requires. Do not commit the jars to source control (they are gitignored under `resources/oracle-jdbc/lib/`).
- **Bundled JRE (Temurin/OpenJDK)** — redistributable under GPLv2 + Classpath Exception; include the
  license and THIRD-PARTY notices as `JRE-LICENSE.txt`. Retain the vendor's required notices.
- **Artifact storage policy** — vendored binaries live only under the gitignored
  `resources/oracle-jdbc/{runtime,bridge,lib}` (like bundled Chromium) and in the approved artifact
  source; they are never committed. License notices ARE bundled (staged into `resources/oracle-jdbc/LICENSES/`).

## 4. Reproducible preparation

```text
npm run prepare:oracle-runtime          # stage + verify + build + generate checksums.json
npm run verify:oracle-runtime-prep      # unit-test the preparation logic (synthetic fixtures)
```

The preparation is deterministic: given the same staged inputs it produces the same `checksums.json`.
It **fails closed** on a missing artifact, a checksum mismatch, the wrong architecture, an unsupported
Java version, or a missing license notice. With no staging directory present it **skips cleanly**
(documented external gate) rather than producing a partial bundle.

## 5. Definition of done (Phase 02)

- [x] Compatibility matrix documented (this file).
- [x] Machine-readable manifest with versions, architecture, filenames, and sha256 slots.
- [x] Approved-acquisition + no-runtime-download policy documented.
- [x] Licensing terms, required notices, and artifact-storage policy documented.
- [x] `prepare:oracle-runtime` verifies checksums, stages artifacts, builds the bridge, and generates
      `checksums.json`, never trusting `JAVA_HOME`/`PATH`.
- [x] `verify:oracle-runtime-prep` covers missing files, checksum mismatch, wrong architecture,
      unsupported Java, missing notices, and repeatable preparation.
- [ ] **External gate:** real versions + sha256 hashes + license text filled in from the official
      vendored artifacts (requires the artifacts, which are not present in this environment).
