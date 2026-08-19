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
| `issue-license.mts` | this folder | its own payload construction (see below) |

`roadmap-bridge.mts` is the trusted adapter the dashboard drives. It exists because the dashboard
server is plain Node and cannot import TypeScript — not because signing needed a second home. It
reads exactly one thing from `argv` (a command from a four-name allowlist), takes its JSON payload on
**stdin**, and writes one JSON line to stdout: a value, or a reason CODE. Never a message, a path, or
a stack. Run it by hand only for diagnosis:

```
echo {} | node node_modules/tsx/dist/cli.mjs tools/license-issuer/roadmap-bridge.mts readiness
```

> **`issue-license.mts` is a known duplicate** (`awkit-vf9r`). It builds the license payload itself
> rather than calling `LicenseIssuerService`, so it has no key-custody check, no private/public key
> match, no atomic write and no validity bounds. Prefer either UI. When you change issuance, change
> the service — do not add a fourth implementation.

## Exact validity windows

`--valid-from` / `--expires` on the CLI, and every preset on the dashboard, resolve to the signed
`validFromUtc` / `expiresAtUtc` pair. The dashboard resolves its presets **before** sending, so the
timestamps shown on the review panel are the ones that get signed — including the 1 Hour preset, which
a day count could not express. The service accepts exactly one of `validityDays` or `validityWindow`,
truncates both boundaries to the minute, and then requires at least one minute, at most 3650 days, and
a start no more than 365 days in the future.

## Key custody (do NOT violate)

- The private key is **never** committed to source control, placed in `resources/`, `.env`, SQLite, or
  any packaged file.
- By default the private key lives outside the repo at:
  `%LOCALAPPDATA%\SpecterStudio\issuer-keys\<keyId>.ed25519.pkcs8.b64`
- Override with `--key <path>` or the `SPECTER_ISSUER_KEY` environment variable.

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
