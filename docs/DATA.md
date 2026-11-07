# Data files

All advisor data lives in `data/` as plain JSON, one record per line, so a changed model shows up as
a one-line diff.

| File | Contents |
|---|---|
| `pumps.json` | 665 pumps with CEC test points |
| `swg.json` | 107 salt water chlorine generators |
| `filters.json` | 124 filters (64 cartridge, 36 sand, 15 DE, 9 hybrid DE) |
| `rules.json` | 33 sizing rules: `{ title, value, src }` per rule ID. See `RULES.md` |
| `meta.json` | version, date, sources (counts are filled in by the build) |
| `advisor-data.js` | **Generated.** All of the above as one script for the web page. Don't edit it by hand |

## Updating data
1. Edit the JSON file(s).
2. Run `node tools/build-data.mjs` to regenerate `advisor-data.js`.
3. Run `node tests/run.mjs`. If a ranking changed *on purpose*, re-record it with
   `node tests/run.mjs --update` and review the diff of `tests/cases/` before committing.

`node tools/build-data.mjs --check` fails if `advisor-data.js` is out of date.

---

## pumps.json
| Field | Meaning |
|---|---|
| `id` | stable unique id (brand-model slug). Used in shared links and test cases, so don't rename it |
| `brand`, `model` | display names |
| `st` | speed type: `VS` variable, `DS` two-speed, `MS` multi-speed, `SS` single-speed |
| `mot` | motor type: `ECM`, `CSCR`, `PSC` |
| `thp` | total horsepower (motor HP × service factor) |
| `nhp` | nominal horsepower |
| `hhp` | hydraulic horsepower, the DOE metric. **No record currently has it**, so the DOE check falls back to `thp > 1.1` |
| `wef` | weighted energy factor (gallons per watt-hour; higher is better) |
| `frame` | motor frame (`48`, `56`, …) |
| `hi`, `lo` | CEC test points at high and low speed: `rpm`, `g` = GPM and `w` = watts, each `[curve A, curve B, curve C]` |
| `dq` | data quality: `ok` |

## swg.json
| Field | Meaning |
|---|---|
| `id`, `mfr`, `model` | identity and display |
| `lbs` | chlorine output, lb/day at 100% |
| `rated` | manufacturer's rated pool size (gallons), or null |
| `ratedQ` | how `rated` was obtained: `verified`, `inferred-from-model-name`, `unknown` |
| `ctrl` | output control: `proportional`, `duty-cycle`, or null if unknown |
| `cyc` | duty-cycle length (minutes) where known |
| `polH` | polarity-reversal interval (hours) |
| `ltRed`, `ltCut` | water temperature (°F) where output reduces / cuts off |
| `auto` | automation platforms that can control it |
| `cell` | replacement cell part number, used for the AquaRite cell-type warning |
| `fam` | hardware family. Only the best model per family is shown |
| `dq` | `verified`, `verified-press-release`, `base-only`, `incomplete`, `conflicting-sources`, `advertised-output-disputed` (the last two are flagged on the page) |
| `notes` | free-text notes; `low-temp`/`sticky` trigger a winter-behavior note |
| `msrp` | list price where known. **Not used in ranking** |

## filters.json
| Field | Meaning |
|---|---|
| `id`, `brand`, `model` | identity and display |
| `ft` | type: `cartridge`, `sand`, `de`, `hybrid-de` |
| `area` | filter area, sq ft (cartridge / DE) |
| `tank` | tank diameter, inches (sand) |
| `bed` | sand bed area, sq ft. If missing it's computed from `tank` |
| `gpm` | manufacturer design max flow |
| `mic` | rated micron |
| `port` | port size, inches |
| `cart` | replacement cartridge part numbers |
| `psi` | max working pressure |
| `dq` | `verified` or `partial` |

## Sources
- Trouble Free Pool sizing guidance and wiki. Each rule cites its page in `src`.
- California Energy Commission (CEC) appliance efficiency database, for pump curve points and WEF.
- Manufacturer spec sheets and manuals, for SWG output, filter area, flow and ports.
