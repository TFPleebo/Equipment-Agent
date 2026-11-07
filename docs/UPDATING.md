# Keeping the catalog and rules up to date

The advisor is only as good as its data. This is the checklist for refreshing it. Every step is either
a script that writes a report you review, or a check that fails loudly, so nothing changes silently.

**Golden rules**
- Never edit `data/advisor-data.js` by hand. It's generated (`node tools/build-data.mjs`).
- Never delete a catalog record or change an `id`. Shared links, tests and "your current pump" use
  them. Mark records `status: "discontinued"` or `sameAs: <id>` instead.
- Every record says where it came from (`src`) and when (`asOf`). `legacy-2026-07` means "not
  re-checked since the original scrape".
- Hand corrections to imported pump data go in `data/overrides/pumps.json` (with a `_why`), never
  straight into `pumps.json`, or the next import will undo them.
- Before committing: `node tools/check-all.mjs` must pass. If recommendations change, run
  `node tools/impact.mjs`, make sure every change has a reason, then `node tests/run.mjs --update`.
  CI runs the same checks on every push and pull request.

## Suggested schedule

| What | Source | How often |
|---|---|---|
| Pumps | California Energy Commission (CEC) appliance database, "Dedicated-Purpose Pool Pumps" | every 3–6 months (new certifications appear continually) |
| Filters | manufacturer spec sheets / manuals / catalogs | once a year, and when a manufacturer launches a line |
| Salt cells | manufacturer documents | once a year, and when a manufacturer launches a line |
| Rules (`rules.json`) | TFP guidance, reviewed by a TFP rule owner | whenever guidance changes |

## 1. Pumps (scripted)

Network access needed: `cacertappliances.energy.ca.gov`. In Claude Code on the web, use the
**equipment-agent** environment, which allows it. The DOE database (`regulations.doe.gov`) blocks
cloud servers, but CEC republishes the same federal certification data, so DOE isn't needed.

1. **Download** (about 1.5–2 hours; resumable, polite to the state's server):
   ```bash
   node tools/cec/fetch-pumps.cjs sources/cec/dppp-YYYY-MM-DD.jsonl
   ```
   On your own computer this needs `npm i playwright && npx playwright install chromium` first.
2. **Dry run** (writes `reports/pumps-import-YYYY-MM-DD.md`, changes nothing):
   ```bash
   node tools/import-pumps.mjs --cec sources/cec/dppp-YYYY-MM-DD.jsonl
   ```
3. **Review the report.** Look for:
   - *Added, by brand*: new brands spelled oddly → add the spelling to `data/brands.json`.
   - *Updated records*: big jumps (e.g. max-speed flow changing by >10%) are worth a look. CEC
     sometimes re-certifies a model with new numbers, which is legitimate, but a typo is possible.
   - *Marked sameAs*: older certifications or rebrands folded into a current record. Check that the
     pairs really are the same pump.
   - *Catalog records CEC doesn't list*: usually pre-2021 pumps that are no longer certified (kept,
     still selectable as "your current pump"). Spot-check for name typos that stopped a match.
   - *Skipped*: incomplete CEC entries. Usually fine.
   Fix anything wrong with an entry in `data/overrides/pumps.json`, and re-run the dry run until the
   report reads right.
4. **Apply, rebuild, check:**
   ```bash
   node tools/import-pumps.mjs --cec sources/cec/dppp-YYYY-MM-DD.jsonl --apply
   node tools/build-data.mjs
   node tools/check-all.mjs
   node tools/impact.mjs --md reports/impact-YYYY-MM-DD.md
   ```
5. Re-record tests (`node tests/run.mjs --update`), bump `meta.version` in `data/meta.json`, add a
   `data/CHANGELOG.md` entry, and commit the source file, the report and the data together.

Re-running step 2 on the same file should report **no changes**. That's the check that overrides and
the import are stable.

## 2. Filters and salt cells (researched, then scripted)

There's no official database, so each pass is a findings file in `sources/specs/` (format in
`sources/specs/README.md`): for each catalog id, what the manufacturer's document says, its URL, and a
verdict (`matches` / `corrected` / `conflict` / `unverified`). Claude can do the research ("verify the
filter catalog against manufacturer specs per docs/UPDATING.md") and you review the file.

Use the **residential maximum** flow rating (what the engine treats as a hard limit), not the
"optimal" or commercial 0.375 GPM/sq ft figure. When sources disagree, keep the more conservative
value and record the conflict.

```bash
node tools/apply-specs.mjs sources/specs/filters-YYYY-MM.json           # dry run, writes reports/...
node tools/apply-specs.mjs sources/specs/filters-YYYY-MM.json --apply
node tools/build-data.mjs && node tools/check-all.mjs && node tools/impact.mjs
```

New models: add them to `data/filters.json` / `data/swg.json` with `src` set to the document URL and
`asOf` set to the date. `tools/check-catalog.mjs` will tell you if anything is missing or implausible.

## 3. Rules

Rule values live in `data/rules.json`, each with a `title`, `value` and `src`. When changing a value:
- keep the old value next to it (`previousX`) and give a `changeReason`;
- set `reviewedBy` to the person who approved it, or `"pending review"` until someone has;
- run `node tools/impact.mjs` and describe the effect in the commit;
- update `docs/RULES.md` (the plain-English spec PoolMath rebuilds from).

## What the checks catch

| Check | Catches |
|---|---|
| `tools/build-data.mjs --check` | JSON edited but the page's data bundle not rebuilt |
| `tools/check-catalog.mjs` | missing/invalid fields, duplicate ids, brand spellings not in `brands.json`, `sameAs` pointing nowhere, missing provenance, physically implausible numbers (flows/watts out of order, filter GPM per sq ft, salt-cell output vs rated size) |
| `tests/run.mjs` | any change to a recommendation in the 28 golden cases |
| `tests/validation.mjs` | changes to the input contract PoolMath relies on |
| `tests/sweep.mjs` | crashes, empty results or NaN across ~2,000 pool setups |
| `tools/impact.mjs` | (report) which recommendations moved and to what |
