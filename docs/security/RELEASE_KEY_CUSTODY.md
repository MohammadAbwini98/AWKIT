# Signing-key custody

Applies to **both** private keys this project signs with:

| Key | Used by | Default location | Override |
|---|---|---|---|
| Offline dependency-manifest (Ed25519) | `scripts/offline-manifest-signature.mjs` | `%LOCALAPPDATA%\SpecterStudio\release-keys\` | `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY` |
| Licence issuer (Ed25519) | the Administration → License Issuer console | `%LOCALAPPDATA%\SpecterStudio\issuer-keys\` | `SPECTER_ISSUER_KEY` |

Tracked by `awkit-2l1` (manifest key, owner action outstanding) and `awkit-5ea` (issuer key).

The issuer key matters more, not less: it signs licences for **other machines**. Issuance fails
closed with `ISSUER_KEY_UNSAFE_LOCATION` when its key resolves inside a synced tree, and the check
runs **before** the key file is opened — a key we must not use is not one we should read.

## The rule

The private key must not live inside a cloud-synced folder.

`.release-local/` is git-ignored, and no key material has ever been tracked in Git. That is not the
whole question. This repository lives under `%USERPROFILE%\OneDrive\...`, so a key stored inside it
is continuously copied to a cloud account — including that provider's version history and recycle
bin. Release signing material then sits outside the documented offline release boundary regardless
of what Git does.

**The tooling will not move or rotate signing material for you.** Custody changes are owner actions,
performed under owner control. What the tooling does is refuse to *use* a key that is in the wrong
place, and tell you precisely what to do.

## Where the key belongs

| Precedence | Location | Notes |
|---|---|---|
| 1 | `--private-key <path>` | Explicit, per-invocation. |
| 2 | `AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY` | Environment override; use for a removable drive or an HSM-backed export path. |
| 3 | `%LOCALAPPDATA%\SpecterStudio\release-keys\offline-manifest-private.pem` | **The approved default.** Outside the repo, outside OneDrive. |
| 4 | `<repo>\.release-local\offline-manifest-private.pem` | Legacy. Still *resolved* so its use produces a precise refusal instead of a confusing "key is missing". |

Any of these is refused if the resolved path sits in a synced tree (OneDrive, Dropbox, Google Drive,
iCloud Drive, Box, pCloud, Creative Cloud). Detection matches whole path segments and the sync
clients' own environment variables — `C:\work\onedriveclone` is not OneDrive and is not refused.

## Owner procedure

Run these yourself. Nothing here is automated, and none of it should be pasted into a script.

**1. Create the approved directory and restrict it to your account.**

```powershell
New-Item -ItemType Directory -Force "$env:LOCALAPPDATA\SpecterStudio\release-keys"
icacls "$env:LOCALAPPDATA\SpecterStudio\release-keys" /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F"
```

**2. Decide: move the existing key, or rotate to a new one.**

Rotating is the stronger choice — the current key has been in a synced folder, so its custody cannot
be reconstructed. Rotating changes the `keyId` in `resources/dependency-manifest.sig`, so the shipped
public trust root (`resources/trust/offline-manifest-public.pem`) must be updated and the manifest
re-signed in the same change.

*To move the existing key* (keeps the current trust root):

```powershell
Move-Item "<repo>\.release-local\offline-manifest-private.pem" "$env:LOCALAPPDATA\SpecterStudio\release-keys\offline-manifest-private.pem"
```

*To rotate* (new trust root; the old public key must be replaced, not added):

```powershell
Remove-Item "resources\trust\offline-manifest-public.pem"
node scripts/offline-manifest-signature.mjs generate-key
```

**3. Securely remove the synced copy.**

Deleting the file is not enough — OneDrive keeps deleted files in the online recycle bin and retains
previous versions. Empty the OneDrive recycle bin (both "Recycle bin" and "Second-stage recycle
bin") and confirm no version history remains for that path.

**4. Re-verify the trust flow.**

```bash
node scripts/offline-manifest-signature.mjs verify
```

This is read-only and never touches the private key. It must exit 0. If you rotated, re-sign first
(`npm run offline:prepare` / the packaging scripts call `sign` for you) and expect a new `keyId`.

**5. Confirm the guard now passes.**

```bash
npm run verify:release-key-custody
```

## What happens if you do nothing

`sign` and `generate-key` fail closed with an actionable message. `verify` is unaffected, so
`npm run validate:offline` still passes and the app still validates its bundle. **Packaging will
fail** at the manifest-signing step (`scripts/generate-dependency-manifest.ps1`) until the key is
moved — that is deliberate: the alternative is quietly producing releases signed from a cloud folder.

For a single deliberate exception:

```bash
AWKIT_ALLOW_SYNCED_SIGNING_KEY=1 node scripts/offline-manifest-signature.mjs sign
```

It prints a warning to stderr and must not be set in any script or CI configuration.

## Logging rule

Error and status output redacts `%LOCALAPPDATA%`, `%USERPROFILE%` and `$HOME` prefixes, so a release
transcript names a location without carrying an account name. Keep it that way: never log a raw
absolute key path, and never log key material.
