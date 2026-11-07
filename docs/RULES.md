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
| `voltage` | `115`, `230`, `unknown` | pump voltage note (`PUMP_VOLTAGE_CHECK`); not a filter until the catalog has voltages |
| `fcLossPpm` | measured daily FC loss, ppm/day (optional, 0.5–10) | SWG chlorine demand: overrides the climate default |
| `climate` | `cool_temperate`, `warm`, `hot_sunny` | SWG chlorine demand, low-temp notes |
| `runtime` | hours/day (default 12, `DEFAULT_RUNTIME`) | pump energy, SWG output % |
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
  - salt cell flow switch, if `hasSWG`: **25 GPM** on a 2″ tee (also used for `2.5+`/`unknown`), **14 GPM** on 1.5″.
    This comes from `SWG_FLOW_SWITCH.byTee`, the single source of truth.
  - (gas heater **not** included by default: it needs ~40 GPM only while firing. Set
    `TURNOVER_FORMULA.heaterSetsDailyMinimum` to true to restore the old behavior.)
- **Feature (peak) flow** = the largest of:
  - spa: jets × **15 GPM** (default `defaultSpaJets` = 4 if not given)
  - waterfall: width (in) × **1.5 GPM/in**
  - gas heater: **40 GPM**
- **Required flow** = max(daily minimum, feature flow).

### 2.2 Which CEC curve to read (`curveIdx`)
Pump flow and watts come from CEC test points on three system curves (A, B, C).
- Above-ground pool → **curve A**
- `2` or `2.5+` pipe → **curve C**
- `1.5` or unknown → **curve A** (conservative)

This follows TFP's Hydraulics 101 mapping (A ≈ restrictive 1.5″ plumbing, k = 0.0167; C ≈ typical 2″,
k = 0.0082). Some industry sources map A = 2″, B = 1.5″, C = 2.5″ instead. If PoolMath adopts that,
the 2″ pools would read curve A.

### 2.3 Filtering out pumps
A pump is **excluded** when:
- It is over the DOE threshold and not variable-speed (`VS_REQUIRED_ABOVE_THP`): hydraulic HP
  ≥ **0.711** where published, otherwise THP > **1.1** as a rough stand-in.
- `newBuild` and not variable-speed (`NEW_POOL_DEFAULTS`).
- Its high-speed flow on the chosen curve is missing or below the required flow.

### 2.4 Energy and cost (`estWattsAtGPM`, rule `PUMP_ENERGY_MODEL`)
- **Variable-speed:** watts(Q) = fixed + k·Q³, fitted through **both** CEC points (low and high speed)
  on the chosen curve, and capped at high-speed watts. The Q³ term is the affinity law on a fixed system
  curve. The fixed term is the drive/motor loss that doesn't shrink with speed (median ~40 W in the
  catalog). If the fit is impossible, it falls back to cube-law scaling of the low point.
- **Two-/multi-speed:** fixed speeds, so no throttling. Use low-speed watts if low speed delivers the
  daily minimum, otherwise high-speed watts.
- **Single-speed:** always high-speed watts.
- Annual kWh = (daily watts × (runtime − feature hours) + high-speed watts × feature hours) × 365,
  where feature hours = `featureHoursPerDay` (1) if there are any features, else 0.
- Annual cost = kWh × `rate`.

### 2.5 Score (higher is better)
| Points | When |
|---|---|
| +25 | always (pump reaches required flow) |
| +25 | can run at the daily minimum: VS low point ≤ minimum + 2 GPM; two-/multi-speed low speed ≥ minimum and ≤ 2× it |
| +14 / +6 / 0 | variable-speed / two- or multi-speed / single-speed |
| + 2 × WEF (WEF clamped 0–12) | efficiency rating |
| − 0.05 × annual cost ($) | running cost |
| +12 | pump brand matches the automation brand (`AUTOMATION_SAME_BRAND`) |
| +2 | data quality `ok` |
| +15 | new build and THP ≥ 2.5 (full-size VS, `NEW_POOL_DEFAULTS`) |

After ranking, pumps with **identical measured performance** (same speed type, motor, THP, nominal HP,
WEF, frame and every curve point) are grouped. The best-ranked one represents the group and the
other model names are listed as variants (`pumpFingerprint`). The top 12 are returned.

### 2.6 Warnings and extra advice
- **Filter flow cap** (`FILTER_FLOW_CAP`): a warning if the required flow exceeds the filter's *rated*
  limit. Sand = bed area × **20 GPM/sq ft**, DE = area × **2**, cartridge = area × **0.75** (catalog median
  rating). For a cartridge between 0.375 and 0.75 GPM/sq ft, there's an info note about the APSP-15
  efficiency guideline instead.
- **Voltage** (`PUMP_VOLTAGE_CHECK`): 115V pads get a "confirm the pump's voltage" warning.
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
- **Daily chlorine demand** = gallons × FC ppm/day × 8.34×10⁻⁶ lb. FC ppm/day is the owner's
  **measured loss** (`fcLossPpm`) when given, otherwise **2 / 3 / 4 ppm/day** for cool / warm / hot &
  sunny. The result says which basis it used (`FC_LOSS_MEASURED` / `FC_LOSS_ESTIMATED`).
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
- If the top pick needs over 50%, it suggests the pump runtime that would bring it to about
  `targetPct` (45%) (`SWG_RUNTIME_TRADEOFF`).
- Short-cycle, low-temperature, polarity (high CH) and Jandy AL-5 notes on individual models.
- Comparison against the current cell (`currentSwgId`): capacity factor and drop in output %, on the same
  output basis as the rankings (no hidden derate).

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
1. Pump first (VS only, full-size preferred).
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

## 7. Changes awaiting review (2026-11)
Every change below is a value in `rules.json` marked `"reviewedBy": "pending review"`, with the previous
value kept next to it, so each one can be reverted by editing data alone.

| # | What changed | Why | Rule / setting | Effect on the test cases |
|---|---|---|---|---|
| 1 | VS energy = fixed + k·Q³ fitted through both CEC points | Cube law from the low point alone ignored ~40 W fixed losses, so before/after comparisons could show *negative* savings | `PUMP_ENERGY_MODEL.vsModel` | EcoStar replacement: −297% → +30% savings. Efficient small-frame VS pumps rank higher |
| 2 | Two-/multi-speed pumps can't throttle | They were modeled like VS pumps, which understated their running cost | `PUMP_ENERGY_MODEL` | Two-speed replacement shows realistic savings (80%) |
| 3 | One salt-cell flow-switch threshold (25 GPM on 2″) | The daily minimum used 22 while the warning used 25 | `SWG_FLOW_SWITCH.byTee` | Salt-cell pools: daily minimum 22 → 25 GPM |
| 4 | Gas heater is a peak demand, not all-day | It needs 40 GPM only while firing | `TURNOVER_FORMULA.heaterSetsDailyMinimum` | Spa + heater + salt pool: $204 → $158/yr |
| 5 | Pump-mode filter check uses the rated limit | 0.375 GPM/sq ft is an efficiency guideline, and the filter engine already used ratings | `FILTER_FLOW_CAP.cartridgeTypicalRatedGpmPerSqFt` | Fewer false "filter too small" warnings |
| 6 | New builds prefer full-size VS (≥ 2.5 THP) | The stated TFP default was never applied | `NEW_POOL_DEFAULTS.fullSizeMinThp / fullSizeBonus` | 15k new pool: 1.65 THP → 2.7 THP TriStar, ~$30/yr |
| 7 | Measured FC loss input | Uses the owner's real demand instead of a climate guess. This is the key PoolMath link | `FC_DEMAND_DEFAULTS.measuredInput` | New case `swg-measured-fc-loss` |
| 8 | Current-cell comparison uses the ranking derate | It still applied the retired 0.75 factor to disputed cells | `SWG_OUTPUT_HAIRCUT.comparisonNote` | New case `swg-upgrade-from-disputed` |
| 9 | 115V voltage check | The answer was collected but never used | `PUMP_VOLTAGE_CHECK` | `pump-agp-small` gets a voltage warning |
| 10 | Default runtime 8 → 12 h/day | At 8 h a 2×-sized salt cell usually exceeds the 50% scale-control limit (e.g. 87% for 20k gal hot & sunny). At 12 h typical pools land at about 30–45%, for ~$18/yr more pump energy on a 20k pool. Users can still edit it | `DEFAULT_RUNTIME.hours` | New case `swg-default-runtime`: 42% output, no "run longer" warning. Existing cases set runtime explicitly and are unchanged |

Top salt cell's required output % by runtime (current engine):

| Pool | 8 h | 10 h | 12 h | 16 h | 24 h |
|---|---|---|---|---|---|
| 15k warm | 49% | 39% | 33% | 24% | 16% |
| 20k warm | 47% | 38% | 44% | 33% | 22% |
| 20k hot & sunny | 87% | 70% | 42% | 44% | 29% |
| 30k hot & sunny | 94% | 76% | 63% | 47% | 31% |
| 20k cool | 44% | 35% | 29% | 22% | 15% |

(The top pick can change between runtimes, which is why some rows aren't strictly decreasing.)

Text-only fixes (no output change): sand cap text 15 → 20; SuperFlo exception marked superseded; runtime
tradeoff triggers at 50% (was documented as 80%); filter-type order documented as the engine runs it;
hard-coded constants moved into `rules.json`.

### Still open
- **Catalog gaps:** no pump `hhp` (so the DOE check uses the THP proxy) and no pump `volts` (so voltage
  can only warn, not filter).
- **Pump max-flow pre-fill** in the filter step (1.5″ → 50, 2″ → 80, 2.5″+ → 100 GPM) is page-only
  and not a rule yet.
- **Full-size threshold (2.5 THP) and bonus (+15)** are judgment values.

## 8. Changelog
- **2026-11 (logic review):** see §7. 26 golden cases (5 new). Default runtime raised to 12 h/day.
- **2026-11:** engine moved out of the page into `engine/advisor.js`. **Bug fixed:** in pump mode,
  choosing a current variable-speed or two-speed pump crashed the results page, because of an undefined
  variable `turnoverGPM`. The comparison now uses the daily minimum flow, the same flow the
  recommended pump is modeled at. No other behavior changed: all other test cases produce identical
  output to the previous page.
