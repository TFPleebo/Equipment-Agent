# Filter spec check (2026-11-07)

Findings: `filters-2026-11.json`. Mode: **applied**.

Verdicts: 93 matches, 2 conflict, 22 unverified, 7 corrected. Catalog records without a finding: 0.

## Values changed

| Record | Field | Was | Now | Why |
|---|---|---|---|---|
| `sta-rite-system-2-plm100` | gpm | - | 100 | catalog had no rated flow; brochure range 38-100 / 47-125 / 66-150 GPM (maximum used, as for the rest of the series) |
| `sta-rite-system-2-plm125` | gpm | - | 125 | catalog had no rated flow; brochure range 38-100 / 47-125 / 66-150 GPM (maximum used, as for the rest of the series) |
| `sta-rite-system-2-plm175` | gpm | - | 150 | catalog had no rated flow; brochure range 38-100 / 47-125 / 66-150 GPM (maximum used, as for the rest of the series) |
| `sta-rite-system-2-plde36` | gpm | 54 | 72 | catalog held Pentair's optimal flow (54); every other filter uses the maximum, so corrected to the 2 GPM/sq ft maximum (range 36-72) |
| `sta-rite-system-2-plde48` | gpm | 72 | 96 | catalog held Pentair's optimal flow (72); every other filter uses the maximum, so corrected to the 2 GPM/sq ft maximum (range 48-96) |
| `pentair-tagelus-ta40d` | tank | 19.5 | 19 | Pentair spec sheet: 19" tank (catalog had 19.5) |
| `hayward-xstream-cc1500` | gpm | 100 | 120 | spec sheet and retailers: 120 GPM, 35 PSI max working pressure (catalog had 100 GPM, 30 PSI). One older Hayward comparison table says 100 GPM. |
| `hayward-xstream-cc1500` | psi | 30 | 35 | spec sheet and retailers: 120 GPM, 35 PSI max working pressure (catalog had 100 GPM, 30 PSI). One older Hayward comparison table says 100 GPM. |

## Sources disagree (catalog value kept)

- `pentair-triton-ii-tr140`: sources give 106 GPM and 141 GPM (= 20 GPM/sq ft x 7.06). Catalog keeps the lower 106 GPM
- `hayward-swimclear-c7030`: Hayward documents disagree on area: brochure 700, product page title 725, owner's manual 680 sq ft. Catalog keeps 700 (brochure). Flow 150 GPM agrees.

## Not verified (need a person to look up)

- `pentair-sand-dollar-sd70` Pentair Sand Dollar SD70: area 3.15 sq ft confirmed; GPM rating not found (catalog 70)
- `sta-rite-cristal-flo-ii-145361` Sta-Rite Cristal-Flo II 145361: no manufacturer source found; values mirror the Sand Dollar equivalents
- `sta-rite-cristal-flo-ii-145362` Sta-Rite Cristal-Flo II 145362: no manufacturer source found; values mirror the Sand Dollar equivalents
- `sta-rite-cristal-flo-ii-145363` Sta-Rite Cristal-Flo II 145363: no manufacturer source found; values mirror the Sand Dollar equivalents
- `sta-rite-cristal-flo-ii-145387` Sta-Rite Cristal-Flo II 145387: no manufacturer source found; values mirror the Sand Dollar equivalents
- `hayward-perflex-ec65a` Hayward Perflex EC65A: spec sheet suggests 67 GPM (2.5 GPM/sq ft NSF max) but its table is garbled; catalog keeps 54 GPM (2 GPM/sq ft)
- `hayward-perflex-ec75a` Hayward Perflex EC75A: spec sheet suggests 100 GPM (2.5 GPM/sq ft NSF max) but its table is garbled; catalog keeps 80 GPM (2 GPM/sq ft)
- `jandy-dev48` Jandy DEV48: no manufacturer source found in this pass
- `jandy-dev60` Jandy DEV60: no manufacturer source found in this pass
- `jandy-js60-sm` Jandy JS60-SM: no manufacturer source found in this pass
- `jandy-js100-sm` Jandy JS100-SM: no manufacturer source found in this pass
- `waterway-proclean-plus-pccf-075` Waterway ProClean Plus PCCF-075: no manufacturer source found in this pass
- `waterway-proclean-plus-pccf-100` Waterway ProClean Plus PCCF-100: no manufacturer source found in this pass
- `waterway-proclean-plus-pccf-125` Waterway ProClean Plus PCCF-125: no manufacturer source found in this pass
- `waterway-proclean-plus-pccf-150` Waterway ProClean Plus PCCF-150: no manufacturer source found in this pass
- `waterway-proclean-plus-pccf-200` Waterway ProClean Plus PCCF-200: no manufacturer source found in this pass
- `waterway-pcde-30` Waterway PCDE-30: no manufacturer source found in this pass
- `waterway-pcde-40` Waterway PCDE-40: no manufacturer source found in this pass
- `intex-krystal-clear-sx1500` Intex Krystal Clear Sand Filter Pump SX1500: Intex publishes pump-system flow (GPH), not filter ratings; not checked
- `intex-krystal-clear-sx2100` Intex Krystal Clear Sand Filter Pump SX2100: Intex publishes pump-system flow (GPH), not filter ratings; not checked
- `intex-krystal-clear-sx2800` Intex Krystal Clear Sand Filter Pump SX2800: Intex publishes pump-system flow (GPH), not filter ratings; not checked
- `intex-krystal-clear-sx3000` Intex Krystal Clear Sand Filter Pump SX3000: Intex publishes pump-system flow (GPH), not filter ratings; not checked
