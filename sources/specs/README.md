# Manufacturer spec checks

Filters and salt cells have no official database (pumps come from the California CEC database, see
`tools/import-pumps.mjs`). They're checked against manufacturer documents: spec sheets, owner's manuals,
catalogs and product pages, plus retailer copies of those documents when the original isn't online.

Each file here records one checking pass, as `entries[catalogId]`:

| Field | Meaning |
|---|---|
| `verdict` | `matches` (catalog already agrees), `corrected` (catalog changed to the source value), `conflict` (sources disagree; `note` says which value the catalog keeps), `unverified` (no good source found) |
| `src` | URL of the document the values came from |
| `note` | anything a reviewer should know (rating basis, which column was used, conflicts) |
| values | filters: `area`, `gpm`, `psi`, `tank`, `bedSqFt`, `port`; salt cells: `lbs`, `rated`, `ctrl`, `ltCut`, `cell`, `fam` |

Apply with `node tools/apply-specs.mjs sources/specs/<file>.json` (dry run, writes a report to
`reports/`), then again with `--apply`. Rating basis used throughout: the **residential maximum** flow
(the engine's hard limit), not the "optimal" or commercial 0.375 GPM/sq ft figure; see `docs/RULES.md`.
