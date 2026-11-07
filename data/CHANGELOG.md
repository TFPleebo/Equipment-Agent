# Catalog changelog

One entry per catalog release (`meta.version` in `data/meta.json`). Newest first.

## 2026.11.0 (in progress)
- **Provenance:** every record now has `src` (document URL, `CEC ...`, or `legacy-2026-07`) and `asOf`.
- **Brands:** canonical names via `data/brands.json`. 33 pumps renamed (Blue → Blue Torrent,
  Energy/Advanced → Advantage, Aquapro → AquaPro, Ningbo → Ningbo Jade, Dab → DAB).
- **Filters:** all 124 checked against manufacturer documents (`sources/specs/filters-2026-11.json`,
  `reports/filters-specs-2026-11-07.md`): 93 match, 7 corrected, 2 conflicting sources, 22 unverified.
  Corrections: Sta-Rite PLM100/125/175 rated flow added; PLDE36/48 changed from Pentair's "optimal" to
  the maximum (72/96 GPM); Hayward XStream CC1500 120 GPM / 35 PSI; Pentair Tagelus TA40D 19" tank.
- **Salt cells:** 18 checked (`sources/specs/swg-2026-11.json`): Jandy TruClear 0.93 lb/day; rated pool
  size added for AutoPilot ChlorSync CS30/40/50 and Digital Nano+; IntelliChlor "IC-30" flagged as
  probably not a real model.
- **Pumps:** pending the CEC refresh (`tools/import-pumps.mjs`).
