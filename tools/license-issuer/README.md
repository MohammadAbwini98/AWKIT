# SpecterStudio License Issuer (offline, separate from the app)

This is the **authorized offline issuer**. It is intentionally **not part of the SpecterStudio
application** and is never bundled into the packaged app (`app/**` + `out/**` are the app; this
`tools/**` directory is not shipped). It holds the **private** signing key; the app holds only the
matching **public** verification key (`src/licensing/crypto/TrustedKeys.ts`).

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
