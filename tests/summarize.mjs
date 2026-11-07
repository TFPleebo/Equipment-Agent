// The "expect" summary of an engine result: headline numbers, top model ids (in order) and
// warning codes (in order). Shared by tests/run.mjs (the golden contract) and tools/impact.mjs.
const ids = (recs, n = 5) => (recs || []).slice(0, n).map((r) => r.product.id);
const codes = (list) => (list || []).map((w) => w.code);

export function summarize(mode, r) {
  if (mode === "pump") return {
    requiredGPM: r.requiredGPM, dailyGPM: r.dailyGPM, featureGPM: r.featureGPM, minDriver: r.minDriver, curve: r.curve,
    top: ids(r.recommendations), topAnnualCostUSD: r.recommendations[0]?.computed.annualCostUSD ?? null,
    comparison: r.comparison ? { kWhSaved: r.comparison.kWhSaved, costSaved: r.comparison.costSaved, pctSaved: r.comparison.pctSaved } : null,
    warnings: codes(r.warnings), repairOptions: (r.repairOptions || []).map((x) => x.ruleId),
  };
  if (mode === "swg") return {
    requiredLbs: r.requiredLbs, lbsNeeded: r.lbsNeeded, ppm: r.ppm, runtime: r.runtime,
    top: ids(r.recommendations), topRequiredOutputPct: r.recommendations[0]?.computed.requiredOutputPct ?? null,
    comparison: r.comparison ? { capacityFactor: r.comparison.capacityFactor, pctDrop: r.comparison.pctDrop } : null,
    warnings: codes(r.warnings), repairOptions: (r.repairOptions || []).map((x) => x.ruleId),
  };
  if (mode === "filter") return {
    chosenType: r.chosenType, min: r.min, pumpMaxGPM: r.pumpMaxGPM,
    top: ids(r.recommendations), sizeUp: (r.alternatives || []).map((a) => a.product.id),
    disqualified: (r.disqualified || []).length,
    comparison: r.comparison ? { factor: r.comparison.factor == null ? null : Math.round(r.comparison.factor * 100) / 100 } : null,
    warnings: codes(r.warnings), typeReasons: codes(r.typeReasons), repairOptions: (r.repairOptions || []).map((x) => x.ruleId),
  };
  return {
    pumpMaxGPM: r.pumpMaxGPM,
    pumpTop: ids(r.pump.recommendations, 3), filterType: r.filt.chosenType, filterTop: ids(r.filt.recommendations, 3),
    swgTop: ids(r.swg.recommendations, 3), advice: codes(r.advice),
  };
}

