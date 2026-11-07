# Data files

All advisor data lives in `data/` as plain JSON, one record per line, so a changed model shows up as
a one-line diff.

| File | Contents |
|---|---|
| `pumps.json` | pumps, from the CEC database (see `docs/UPDATING.md`) |
| `swg.json` | 107 salt water chlorine generators |
| `filters.json` | 124 filters (64 cartridge, 36 sand, 15 DE, 9 hybrid DE) |
| `rules.json` | sizing rules: `{ title, value, src }` per rule ID. See `RULES.md` |
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
| `hhp` | rated hydraulic horsepower, the DOE compliance metric (from CEC). Where missing (legacy records), the DOE check falls back to `thp > 1.1` |
| `wef` | weighted energy factor (thousand gallons per kWh; higher is better). Imported records carry CEC's figure |
| `frame` | motor frame (`48`, `56`, …); kept from legacy data, CEC doesn't publish it |
| `hi`, `lo` | test points at maximum speed and at the low-flow point: `rpm`, `g` = GPM and `w` = watts, each `[curve A, curve B, curve C]`. CEC tests on curve C only; A and B are derived (see `abSrc`). Single-speed pumps have one operating point, so `lo` equals `hi` |
| `mid` | variable-speed only: CEC's third ("high flow") test point on curve C, `{rpm, gpm, w}`. Not used by the engine yet; kept for a future 3-point energy model |
| `hmax` | maximum head (feet) at full speed, from CEC; used to derive curves A and B |
| `abSrc` | how curves A/B were obtained: `derived-parabolic` (rule `PUMP_CURVE_DERIVATION`) or `derived-ratio` (fallback when max head is missing). Absent on legacy records, whose A/B came from the original scrape |
| `volts` | supply voltage(s) when CEC's model number states them, e.g. `[230]` or `[115, 230]` |
| `class` | `inground`, `agp`, `inflatable`, `booster`, `waterfall`, `pond`, from CEC's product group; controls which pools it can be recommended for (rule `PUMP_CLASS_USE`). Legacy records without it count as `inground` |
| `status` | `active` or `discontinued` (CEC archived). Discontinued pumps are never recommended but stay selectable as "your current pump" |
| `sameAs` | id of the record this one duplicates (an older certification, or the same pump under another name). Never recommended; its name still finds the main record in the picker |
| `cec` | the CEC listing it came from: `{model, brand, added, group}`. Used to match on re-import |
| `src`, `asOf` | where the record's values came from and when (all catalogs have these) |
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
