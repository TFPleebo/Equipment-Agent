# Sizing rules: how the advisor decides

This is the plain-English specification of the Pool Equipment Advisor's logic. It is written so
the advisor can be **rebuilt in another codebase** (for example inside PoolMath) and checked against
the golden test cases in `tests/cases/`.

- **Reference implementation:** `engine/advisor.js` (function names are given in each section).
- **Rule values and sources:** `data/rules.json`. Every rule has an ID (e.g. `SWG_2X_RULE`), a
  `title`, a `value` block and a `src` citation. Every reason and warning the engine produces carries
  the `ruleId` it came from, which is how the page cites its reasoning.
- **Data fields:** see `docs/DATA.md`.

Severity levels used on every reason/warning: `good`, `info`, `warning`, `blocker`.

---

## 1. Inputs (the "profile")

| Field | Values | Used by |
|---|---|---|
| `gallons` | number | all |
| `poolType` | `inground-plaster`, `inground-vinyl`, `inground-fiberglass`, `agp` (above-ground) | pump curve, AGP bonding |
| `pipe` | `1.5`, `2`, `2.5+`, `unknown` | pump curve, flow switch, plumbing advice |
| `automation` | `none`, `pentair`, `hayward`, `jandy`, `other` (+ optional `automationModel` text) | brand match, repair hints |
| `voltage` | `115`, `230`, `unknown` | collected (not yet used in ranking) |
| `climate` | `cool_temperate`, `warm`, `hot_sunny` | SWG chlorine demand, low-temp notes |
| `runtime` | hours/day (default 8) | pump energy, SWG output % |
| `rate` | $/kWh (page default 0.17) | pump running cost |
| Pump: `failure`, `currentPumpId`, `spa`, `spaJets`, `cleaner`, `gasHeater`, `hasSWG`, `waterfallWidth` (in), `filterType`, `filterSize`, `quotedPrice` | | pump engine |
| SWG: `failure`, `currentSwgId`, `cycle` (`long`/`short`), `highCH`, `newPlaster`, `bonding` | | SWG engine |
| Filter: `replacingType`, `currentFilterId`, `desiredType` (`recommend`/`cartridge`/`sand`/`de`/`hybrid-de`), `failureMode`, `pipeIn`, `pumpMaxGPM`, `debris` (`low`/`average`/`high`), `waterCost` (`low`/`high`), `clarity`, `padSpace` | | filter engine |
| `newBuild` | true for the new-pool planner | all engines |

---

## 2. Pump selection: `pumpEngine(profile)`

### 2.1 Required flow (`TURNOVER_FORMULA`, `FEATURE_FLOW_DEMANDS`)
Minimum flow is set **by the equipment that must work, not by pool volume** (no turnover rule).

- **Daily minimum flow** = the largest of:
  - skimmer: **15 GPM**
  - salt cell flow switch, if `hasSWG`: **22 GPM** on 2″ (also used for `2.5+`/`unknown`), **14 GPM** on 1.5″
  - gas heater, if `gasHeater`: **40 GPM**
- **Feature (peak) flow** = the largest of:
  - spa: jets × **15 GPM** (default 4 jets if not given)
  - waterfall: width (in) × **1.5 GPM/in**
  - gas heater: **40 GPM**
- **Required flow** = max(daily minimum, feature flow).

### 2.2 Which CEC curve to read (`curveIdx`)
Pump flow and watts come from CEC test points on three system curves (A, B, C).
- Above-ground pool → **curve A**
- `2` or `2.5+` pipe → **curve C**
- `1.5` or unknown → **curve A** (conservative)

### 2.3 Filtering out pumps
A pump is **excluded** when:
- It is over the DOE threshold and not variable-speed (`VS_REQUIRED_ABOVE_THP`): hydraulic HP
  ≥ **0.711** where published, otherwise THP > **1.1** as a rough stand-in.
- `newBuild` and not variable-speed (`NEW_POOL_DEFAULTS`).
- Its high-speed flow on the chosen curve is missing or below the required flow.

### 2.4 Energy and cost (`estWattsAtGPM`)
- Watts at a target flow use the pump affinity laws (watts ∝ flow³), anchored on the pump's
  **low-speed** CEC point and capped at its high-speed watts. A single-speed pump always uses its
  high-speed watts.
- Annual kWh = (daily-flow watts × (runtime − feature hours) + high-speed watts × feature hours) × 365,
  where feature hours = 1 if there are any features, else 0.
- Annual cost = kWh × `rate`.

### 2.5 Score (higher is better)
| Points | When |
|---|---|
| +25 | always (pump reaches required flow) |
| +25 | low-speed flow ≤ daily minimum + 2 GPM ("can idle down") |
| +14 / +6 / 0 | variable-speed / two- or multi-speed / single-speed |
| + 2 × WEF (WEF clamped 0–12) | efficiency rating |
| − 0.05 × annual cost ($) | running cost |
| +12 | pump brand matches the automation brand (`AUTOMATION_SAME_BRAND`) |
| +2 | data quality `ok` |

After ranking, pumps with **identical measured performance** (same speed type, motor, THP, nominal HP,
WEF, frame and every curve point) are grouped. The best-ranked one represents the group and the
other model names are listed as variants (`pumpFingerprint`). The top 12 are returned.

### 2.6 Warnings and extra advice
- **Filter flow cap** (`FILTER_FLOW_CAP`): if the user's filter would be overrun by the required flow.
  Sand cap = bed area × **20 GPM/sq ft**; cartridge = area × **0.375**; DE = area × **2**.
- **Salt cell flow switch** (`SWG_FLOW_SWITCH`): when `hasSWG`, compares the top pick's low-speed flow
  with **25 GPM** (2″ tee) / **14 GPM** (1.5″ tee) and warns if the low speed could fail to close the switch.
- **SuperFlo build date** (`SUPERFLO_AUTOMATION`): SuperFlo / SuperMax / WhisperFlo VST VS pumps
  with automation get a note about RS-485 and the 11/20/2020 build-date cutoff.
- **Repair hints:** AquaLogic boards (`AUTOMATION_EXCEPTIONS`) and EcoStar drives (`ECOSTAR_KNOWN_ISSUE`).
- **Before/after comparison** (if `currentPumpId` is chosen): current vs. top pick kWh and cost,
  % saved, and payback years if `quotedPrice` was entered.

---

## 3. Salt water generator (SWG) selection: `swgEngine(profile)`

### 3.1 Capacity needed (`SWG_2X_RULE`, `FC_DEMAND_DEFAULTS`)
- **Required capacity** = 0.7 lb/day per 10,000 gal (20,000 gal → 1.4 lb/day). This is TFP's
  "2× pool volume" rule expressed in pounds per day.
- **Daily chlorine demand** = gallons × FC ppm/day × 8.34×10⁻⁶ lb, with **2 / 3 / 4 ppm/day** for
  cool / warm / hot & sunny.
- **Required output %** = demand ÷ (cell lb/day × runtime/24) × 100.
- Published output is used as-is (`SWG_OUTPUT_HAIRCUT`, derating factor 1). Models whose output is
  disputed are flagged instead.

### 3.2 Score
| Points | When |
|---|---|
| +50 / −40 | meets / misses required capacity (primary rule) |
| + 8 × min(cell lb/day, required) | rewards capacity up to the need |
| + 6 × (headroom over required, clamped 0–3 lb) | capped headroom bonus |
| −15 / −6 | output % over 100 / over **50%** (`SWG_MAX_OUTPUT_PCT`) |
| +8 | rated gallons ≥ 2× pool |
| +12 / −10 | short pump cycles: proportional control / duty-cycle |
| +12 | controllable by the user's automation brand |
| +6 / +2 / 0 | data quality verified / other / base-only |
| −2 | output disputed |

Only the best model in each hardware **family** (`fam`) is kept. The top 12 are returned.

### 3.3 Warnings and advice
- New plaster < 30 days: **blocker**, no salt yet (`NEW_PLASTER_NO_SALT`).
- Above-ground without confirmed bonding (`AGP_BONDING_CHECK`).
- No single cell meets the rule → consider multiple cells. Top pick over 100% → longer pump schedule.
- Flow switch minimum by tee size (`SWG_FLOW_SWITCH`).
- AquaRite / CircuPool panels: set the cell-type setting to match the installed cell
  (`AQUARITE_CELL_TYPE`). This is a stronger warning when the user is swapping cells in the same panel family.
- Intex: on/off only (`SWG_ONOFF_ONLY`). CYA 70–80 (`SWG_CYA_CELL_LIFE`). Cell life hours (`CELL_LIFE`).
- If the top pick needs over 50%, it suggests the pump runtime that would bring it to about 45%
  (`SWG_RUNTIME_TRADEOFF`).
- Short-cycle, low-temperature, polarity (high CH) and Jandy AL-5 notes on individual models.
- Comparison against the current cell (`currentSwgId`): capacity factor and drop in output %.

---

## 4. Filter selection: `filterEngine(profile)`

### 4.1 Filter type when "recommend for me" (`recommendFilterType`)
Checked in this order:
1. High water cost → **cartridge** (no backwashing).
2. Clarity priority → **DE**.
3. New build with heavy debris → **cartridge**, sized up (TFP new-pool default).
4. Heavy debris → **sand**.
5. Otherwise → **cartridge** (TFP's general-purpose pick).

### 4.2 Minimum size (`FILTER_SIZING`, `filterMinRequired`)
- **Cartridge:** minimum **150 sq ft per 10k gal**. About **200 sq ft per 10k gal** is the sweet
  spot *and the useful upper limit*: a cartridge can be oversized.
- **Sand:** 24″ tank, or **30″** if over 25k gal or heavy debris.
- **DE:** 48 sq ft, or **60** if over 25k gal. **Hybrid DE:** 80, or **100** if over 25k gal.

### 4.3 Disqualifiers (`FILTER_MUST_NOT_BOTTLENECK_PUMP`)
- Below minimum size → excluded.
- Allowable flow below the pump's max flow → excluded. Sand allowable = bed area × 20 GPM/sq ft
  (bed area from the data, or π·(tank/2/12)²). Other types use the manufacturer's design max GPM.
- Ports smaller than the plumbing → warning (−5 points), not excluded.

The page pre-fills pump max flow from pipe size if the user doesn't know it: 1.5″ → 50, 2″ → 80,
2.5″+ → 100 GPM.

### 4.4 Score: the smallest model that comfortably passes wins
Start at 100, then:
- − (25, or 12 on a new build) × (oversize ratio − 1, clamped 0–2)
- Cartridge above the ~200 sq ft/10k target: − 30 × (fraction over target, clamped 0–1)
- −6 if within 5% of the bare minimum
- + 10 × flow comfort (margin over pump flow, capped at 30%), or 6 if pump flow is unknown
- + 8 × data quality (1 verified, 0.4 otherwise); −5 if ports are undersized

Ties go to the smaller filter. The next size up (not exceeding the cartridge target) is offered as a
"size-up" alternative. Near-miss disqualified models are listed too. It also gives repair-vs-replace
facts (`FILTER_REPAIR_FACTS`) and a current-vs-recommended area comparison.

---

## 5. New-pool planner: `padPlanner(profile)`
Runs all three engines with `newBuild: true`:
1. Pump first (VS only).
2. Filter sized to the **top pump's full-speed flow**, with type "recommend".
3. SWG as a first salt system.

Cross-checks: does the filter keep up with the pump at full speed, is the salt cell sized to 2×,
and an automation same-brand note.

## 6. Shared advice added to every result (`recommend()`)
- Plumbing velocity limits by pipe size (`PLUMBING_SIZE_GUIDANCE`): 1.5″ = 38 suction / 51 return GPM,
  2″ = 63/84, 2.5″ = 90/119, 3″ = 138/184 (suction ≤ 6 ft/s, return ≤ 8 ft/s).
- Heater bypass if there is a gas heater (`HEATER_BYPASS`).
- Warranty check (`WARRANTY_CHECK`).

---

## 7. Open questions for review
These are places where the code and `rules.json` disagree, or values are hard-coded. **Behavior was
left exactly as it was.** Each one needs a decision from the rule owner before it is changed.

1. **Two salt-cell flow-switch numbers.** The daily minimum uses `TURNOVER_FORMULA.swgFlowSwitchGpm`
   (**22** GPM on 2″), but the flow-switch warning uses `SWG_FLOW_SWITCH.byTee` (**25** GPM on 2″).
2. **Sand flow cap text.** `FILTER_MUST_NOT_BOTTLENECK_PUMP.sandSource` still says "15 × bed area".
   The code uses `FILTER_FLOW_CAP.sandGpmPerSqFt` = **20** (the reviewed value).
3. **SuperFlo statement out of date.** `AUTOMATION_EXCEPTIONS` still says SuperFlo VS speeds "cannot be
   controlled by any automation". `SUPERFLO_AUTOMATION` supersedes this, and the code uses the newer
   rule, but the old text is still in the data.
4. **Output % thresholds.** `SWG_RUNTIME_TRADEOFF.whenOutputAbovePct` is 80, but the code uses
   `SWG_MAX_OUTPUT_PCT` (50). The page glossary also says "Above ~80% leaves little headroom".
5. **Current-cell comparison derates disputed cells by 0.75** (hard-coded), while recommended cells are
   not derated (factor 1 since the 2026-07 review). This makes a disputed current cell look weaker
   than it would be in the rankings.
6. **Filter-type order.** `FILTER_TYPE_RECOMMENDATION.order` lists debris before clarity. The code
   checks clarity before debris.
7. **Energy at very low flow.** Watts are scaled with the cube law from each pump's lowest CEC point.
   A pump whose lowest test point is at a higher flow (e.g. EcoStar SP3400VSP, 28 GPM on curve C) can
   model *cheaper* at 15 GPM than one tested lower (e.g. 12 GPM). The cube law ignores the
   drive's fixed losses near zero flow. Test case `pump-replace-ecostar` shows this: negative "savings".
   The page handles it with "your current pump already uses about as little energy…".
8. **Hard-coded constants not in rules.json:** default 4 spa jets, 1 feature hour/day, the 45% target in
   the runtime suggestion, pump max-flow pre-fill by pipe size (50/80/100), 8.34×10⁻⁶ lb per ppm·gal.

## 8. Changelog
- **2026-11:** engine moved out of the page into `engine/advisor.js`. **Bug fixed:** in pump mode,
  choosing a current variable-speed or two-speed pump crashed the results page, because of an undefined
  variable `turnoverGPM`. The comparison now uses the daily minimum flow, the same flow the
  recommended pump is modeled at. No other behavior changed: all other test cases produce identical
  output to the previous page.
