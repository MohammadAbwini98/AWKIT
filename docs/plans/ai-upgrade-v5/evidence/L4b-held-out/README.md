# L4b held-out set: format and structural rules

The owner's decision of 2026-09-25 (`../L4b-owner-decision-proposal-2026-09-25.md` §0) makes a held-out set
mandatory for L4b's delivered-experience acceptance (DX).

## Who chooses it

- The owner, or a person the owner names. **Never the implementing agent.**
- The agent defines this format and runs the structural check. It does not select, curate, rank or
  preview cases.
- It runs no model and no display gate on the set before the set is committed with its hash.

## Format

- Put one flow per file in `flows/`, as a `.json` file exactly as SpecterStudio saves a flow
  (`{ "id", "name", "version", "nodes": [...], "edges": [...] }`).
- File names are yours to choose. They never reach a capture or a case id.
- Nothing else goes in `flows/`.

## Structural rules (`npm run verify:ai-authoring-held-out` checks each and names the file)

- **The product accepts it as a flow.** It has an id, a nodes array and an edges array, with at most
  the product's node limit (the same intake the Flow Designer's AI request uses).
- **It is outside the labelled set.** Its flow id is not a labelled flow's, and it does not carry the
  labelled set's canary.
- **The product's validator finds at least one issue in it**, so there is something to ask about.
- **No two files hold the same flow.**
- **Across all files, the requests send at least 17 issues.** One request sends at most two issues,
  blocking ones first; any others are counted as truncated and not sent.
- **Nothing that the product's redaction treats as sensitive:**
  - a URL with a query string or fragment;
  - a `password=` / `api_key=`-style pair;
  - a bearer token or JWT;
  - a private key;
  - a `C:\Users\...` path.

  The set is committed to the repository, so use placeholders. The model's request never carries step
  names, typed values, selectors or URLs, so a placeholder changes nothing the model is asked.

## Freezing it

1. Put the flows in `flows/` and run `npm run verify:ai-authoring-held-out`.
   - When the set is valid, the first run writes `inventory.json`: each case's id, file, content hash
     and what the request sends, plus the corpus SHA-256.
   - The inventory is written once. A later change to the flows shows up as a mismatch, and is never
     rewritten silently.
2. Commit `flows/`, `inventory.json` and this folder, then record the commit and the corpus hash in §0.
3. Only after that can a fresh authoring run start. The live launcher refuses one until the set is
   committed and matches its inventory.
