# SpecterStudio License Issuer CLI (offline)

This is the command-line alternative to the in-app **License Issuer** page. The CLI itself is
intentionally not bundled (`tools/**` is not shipped). Both workflows use the same trust model: the
private signing key stays in external issuer-workstation storage, while the package contains only the
matching public verification key (`src/licensing/crypto/TrustedKeys.ts`).

For the UI workflow, a Super User creates the one allowed `Issuer` account. That user signs in, opens
**Administration → License Issuer**, selects an activation-request JSON, and chooses **Issue and save
license**. The generated `.dat` is written automatically to
`%LOCALAPPDATA%\SpecterStudio\issuer-output\`.

## Three front ends, one issuer

| Front end | Where | Calls |
|---|---|---|
| In-app **License Issuer** page | packaged app, exclusive `Issuer` role + re-auth | `LicenseIssuerService` |
| **Licenses Issue** on the Program Status dashboard | `npm run roadmap`, developer tooling | `roadmap-bridge.mts` -> `LicenseIssuerService` |
| `issue-license.mts` | this folder | `LicenseIssuerService` |

`roadmap-bridge.mts` is the trusted adapter the dashboard drives. It exists because the dashboard
server is plain Node and cannot import TypeScript — not because signing needed a second home. It
reads exactly one thing from `argv` (a command from a four-name allowlist), takes its JSON payload on
**stdin**, and writes one JSON line to stdout: a value, or a reason CODE. Never a message, a path, or
a stack. Run it by hand only for diagnosis:

```
echo {} | node node_modules/tsx/dist/cli.mjs tools/license-issuer/roadmap-bridge.mts readiness
```

`issue-license.mts` is an **argv adapter**, not an issuer. It parses flags and hands an unchecked
input object to `LicenseIssuerService`; every rule about whether a license may be signed lives there.
It was folded onto the service in `awkit-vf9r` — until then it was a second, looser implementation
that accepted any `--type` and any `--entitlements`, enforced no validity bounds, ran no key-custody
check, never verified the key matched `TRUSTED_KEYS`, wrote non-atomically, defaulted to the
verification-only `key1`, and generated serial numbers with `Math.random()`.

When you change issuance, change the service. `verify:roadmap-license-issuer` now guards all three
front ends: eight checks assert the CLI builds no payload, generates no serial or id, writes neither
the license nor the history, and resolves its key through the shared location contract. Re-adding
local signing to the CLI fails four of them.

### CLI flags

| Flag | Meaning |
|---|---|
| `--request <path>` | **Required.** The activation-request JSON the requesting machine produced. |
| `--type <t>` | `trial` \| `standard` \| `enterprise`. Default `standard`. |
| `--entitlements a,b` | Comma-separated, from the issuer entitlement set. Default `workflow.execute`. |
| `--days N` | Whole days from issuance. Default 365. Mutually exclusive with the window flags. |
| `--valid-from` / `--expires` | Exact UTC window, minute precision (e.g. `2026-09-01T09:00`). Both or neither. |
| `--keyId <id>` | Defaults to `DEFAULT_ISSUER_KEY_ID`, the ACTIVE signing key — not a hardcoded one. |
| `--key <path>` | Override the key path (`SPECTER_ISSUER_KEY` also works). |
| `--out-dir <dir>` | Override the confined output folder. |

`--out` was **removed**. The service owns both the output folder and the file name, and records that
exact name in the append-only issuance history — so honouring an arbitrary destination would either
bypass the atomic write or leave the audit log naming a file that no longer exists. Passing `--out`
now fails with that explanation rather than being silently ignored. The full path of the signed
license is printed on success.

On refusal the CLI prints the service's `IssuerReasonCode` plus a sentence of guidance, and exits
non-zero. Options are validated **before** the private key is opened, so a request that cannot
produce a legal license never causes the key to be read at all.

## Exact validity windows

`--valid-from` / `--expires` on the CLI, and every preset on the dashboard, resolve to the signed
`validFromUtc` / `expiresAtUtc` pair. The dashboard resolves its presets **before** sending, so the
timestamps shown on the review panel are the ones that get signed — including the 1 Hour preset, which
a day count could not express. The service accepts exactly one of `validityDays` or `validityWindow`,
truncates both boundaries to the minute, and then requires at least one minute, at most 3650 days, and
a start no more than 365 days in the future.

## One resolver, four front ends (`awkit-uwfo`)

`resolveIssuerKeyLocation()` in `src/licensing/issuer/IssuerLocations.ts` is the single answer to
"where is the key, where did that answer come from, and is there an answer at all". The Electron main
composition root, `roadmap-bridge.mts`, `issue-license.mts` and `keygen.mts` all call it, so a key can
never be generated in one place and looked for in another.

It **never** returns a working-directory-relative path. No profile variable, a relative
`SPECTER_ISSUER_KEY`, or a key id that is not a plain file-name segment each fail closed with a
`problem`, which readiness reports as `CONFIGURATION_ERROR`. (`nonElectronRuntimeRoot()` used to end
`?? "."`, which resolved a PRIVATE KEY under the caller's cwd — the repository root for the bridge.)

`--key` on the CLI is the one exception, and deliberately so: it is an explicit operator argument in a
single process, so a relative value is resolved against that shell's cwd rather than refused. An
environment variable is inherited by children that do not share a cwd, which is why the same leniency
would be wrong there.

## Readiness states

`readiness()` answers with one of five states rather than a bare boolean, because "provision a key",
"fix this file's permissions" and "this build does not trust that key id" need different actions:

| State | Reason codes | What the operator does |
|---|---|---|
| `READY` | — | Issue. |
| `MISSING` | `ISSUER_KEY_MISSING` | Provision the key at the reported location. |
| `INACCESSIBLE` | `ISSUER_KEY_INACCESSIBLE` | Fix permissions / the path is a folder / something holds it open. |
| `INVALID_FORMAT` | `ISSUER_KEY_INVALID` | The bytes are not a PKCS8 Ed25519 private key. |
| `CONFIGURATION_ERROR` | `ISSUER_KEY_UNKNOWN_ID`, `ISSUER_KEY_MISMATCH`, `ISSUER_KEY_RETIRED`, `ISSUER_KEY_UNSAFE_LOCATION`, `ISSUER_KEY_LOCATION_INVALID` | The key file is fine; the configuration around it is not. |

The in-app console also shows `expectedKeyLocation` — the `redactKeyPath`'d location, so a MISSING key
is actionable. The dashboard bridge deliberately leaves it unset: its answer is served to a browser
over HTTP, and `verify:roadmap-license-issuer` asserts no key path appears there.

Gates: `npm run verify:issuer-key-resolution` (83) and `npm run verify:issuer-readiness-gui` (21,
real Electron, needs a build).

## Key custody (do NOT violate)

- The private key is **never** committed to source control, placed in `resources/`, `.env`, SQLite, or
  any packaged file.
- By default the private key lives outside the repo at:
  `%LOCALAPPDATA%\SpecterStudio\issuer-keys\<keyId>.ed25519.pkcs8.b64`
- Override with `--key <path>` or the `SPECTER_ISSUER_KEY` environment variable. The variable must be
  an **absolute** path.
- There is no fallback, dev, or auto-generated key. A missing key blocks issuance and names the
  location to provision; nothing manufactures signing material to make the issuer ready.
- `keygen.mts` defaults to `DEFAULT_ISSUER_KEY_ID` (the ACTIVE key) and refuses to overwrite an
  existing file, so running it bare on a provisioned workstation stops with an explanation rather than
  writing a second key. It used to default to `key1` — verification-only since 2026-08-19 — which
  would have produced a key that can never sign and whose public half matches nothing shipped.

## Commands

Generate a new key pair (prints the PUBLIC key to paste into `TrustedKeys.ts`):

```
npx tsx tools/license-issuer/keygen.mts --keyId key2
```

Issue a license from a machine's activation request:

```
npx tsx tools/license-issuer/issue-license.mts \
  --request path\to\activation-request.json \
  --type standard \
  --entitlements workflow.execute,workflow.concurrent,automation.browser \
  --days 365 \
  --out path\to\specterstudio-license.dat
```

`--valid-from` / `--expires` accept explicit `YYYY-MM-DDTHH:mm` UTC values (minute precision) and
override `--days`. Each issuance is appended to `issuance-history.jsonl` next to the key file.

## Trust boundary

The issuer binds a license to a machine by copying the `fingerprintHash` from that machine's activation
request into the signed `machineFingerprintHash`. The app enforces the binding cryptographically — a
license copied to another machine fails `MACHINE_MISMATCH` regardless of where the file is placed.
