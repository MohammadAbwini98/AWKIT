# SpecterStudio License Issuer CLI (offline)

This is the command-line alternative to the in-app **License Issuer** page. The CLI itself is
intentionally not bundled (`tools/**` is not shipped). Both workflows use the same trust model: the
private signing key stays in external issuer-workstation storage, while the package contains only the
matching public verification key (`src/licensing/crypto/TrustedKeys.ts`).

For the UI workflow, a Super User creates the one allowed `Issuer` account. That user signs in, opens
**Administration → License Issuer**, selects an activation-request JSON, and chooses **Issue and save
license**. The generated `.dat` is written automatically to
`%LOCALAPPDATA%\SpecterStudio\issuer-output\`.

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
