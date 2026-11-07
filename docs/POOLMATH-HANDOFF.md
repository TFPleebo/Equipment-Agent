# Pool Equipment Advisor → PoolMath handoff

## What it is
A rules-based equipment selector for pool owners. It sizes and ranks **real models** using TFP
guidance, CEC test data and manufacturer specs, and explains every recommendation with the rule it
came from. It never uses sponsorship or price to rank.

- **Pump:** required flow from equipment (not turnover), DOE variable-speed rule, energy and cost per
  year, automation brand match, flow-switch and filter-cap checks, before/after savings.
- **Salt system (SWG):** TFP 2× rule in lb/day, output % at the user's runtime, cycle/climate/automation
  fit, AquaRite cell-type warning, comparison with the current cell.
- **Filter:** type recommendation, TFP minimum size, must not choke the pump, smallest comfortable
  model plus a size-up option, repair-vs-replace facts.
- **New pool:** sizes pump, filter and salt cell together and cross-checks them.

Live page: https://tfpleebo.github.io/Equipment-Agent/Pool%20Equipment%20Advisor.html

## What's in this repo
| Path | What |
|---|---|
| `engine/advisor.js` | the sizing engine, no screen code. Plain JavaScript: works in a browser `<script>`, Node, or a JS bridge |
| `data/*.json` | pumps, SWGs, filters, rules (see `docs/DATA.md`) |
| `docs/RULES.md` | every rule and formula in plain English, plus **open questions for review** |
| `tests/cases/*.json` | 25 golden cases: input profile → expected numbers, top models and warnings |
| `tests/run.mjs` | runs the engine on every case (`node tests/run.mjs`) |
| `Pool Equipment Advisor.html` | the standalone web page, which uses the engine above |

## Two ways to integrate

### Option A: embed the web engine (fastest)
For PoolMath's web app, or a mobile web view:
```js
const advisor = PoolAdvisor.createAdvisor(window.ADVISOR_DATA); // or build the data object from data/*.json
const result  = advisor.recommend("pump", profile);             // "pump" | "swg" | "filter" | "newpool"
// result.recommendations[i] -> { product, score, rank, reasons[], fit{}, computed{} }
// result.warnings[]         -> { code, severity, ruleId, text }
```
The output is plain JSON, so PoolMath can render it in its own style. Or show the existing page
in a web view, pre-filled through the shared-link format `#r=<base64 JSON {m: mode, p: profile}>`.

### Option B: native rebuild
1. Implement the logic in `docs/RULES.md`, reading the values from `data/rules.json`.
2. Ship `data/*.json` as app data, or serve it so the catalog can update without an app release.
3. Run your implementation over `tests/cases/*.json` and match each case's `expect` block: headline
   numbers, top model ids in order, and warning codes in order.

## Inputs PoolMath could pre-fill from a user's pool
| Advisor field | Likely PoolMath source |
|---|---|
| `gallons` | pool volume |
| `poolType` | surface type / above-ground flag |
| `hasSWG`, `currentSwgId` | SWG setting / model |
| `climate` | location (fallback only) |
| `fcLossPpm` | the user's **measured daily FC loss** from their logs. The engine already accepts it and it overrides the climate default |
| `runtime` | pump schedule |
| `currentPumpId`, `filterType`, `filterSize` | equipment profile, if PoolMath stores it |

Using the user's **real FC loss** from their PoolMath logs is the most valuable link-up. It turns
the SWG sizing from a regional estimate into one based on that user's actual pool. The engine already supports it (`fcLossPpm`).

## Before shipping
- Review the **changes awaiting review** in `docs/RULES.md` §7. Each one is a `rules.json` value that
  can be reverted without touching code.
- Pump `hhp` (hydraulic HP) isn't in the data yet, so the DOE check uses the rough THP proxy.
- Catalog freshness: decide who maintains `data/*.json` and how often (CEC publishes updates).
