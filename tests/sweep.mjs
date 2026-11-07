// Robustness sweep: runs every mode over a grid of ~1,700 pool profiles and fails if any
// result crashes, comes back empty, or has NaN / undefined / Infinity in its output.
//   node tests/sweep.mjs
// Golden cases (tests/run.mjs) pin exact answers; this pins "always gives a sensible answer".
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createAdvisor } = require(join(root, "engine/advisor.js"));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const advisor = createAdvisor({
  pumps: read("data/pumps.json"), swg: read("data/swg.json"), filters: read("data/filters.json"),
  rules: read("data/rules.json"), meta: read("data/meta.json"),
});

const problems = {};
const note = (key, prof, detail) => { (problems[key] = problems[key] || { n: 0, prof, detail }).n++; };
const BAD = /NaN|undefined|Infinity/;

const variants = {
  pump: [{}, { hasSWG: true }, { spa: true, spaJets: 8, gasHeater: true, hasSWG: true }, { waterfallWidth: 48 },
    { filterType: "cartridge", filterSize: 100, spa: true }, { filterType: "sand", filterSize: 19 }, { voltage: "115", runtime: 24 }],
  swg: [{ cycle: "long" }, { cycle: "short", runtime: 4 }, { cycle: "long", runtime: 24, fcLossPpm: 6 }, { highCH: true, newPlaster: true }],
  filter: [{ desiredType: "recommend", pumpMaxGPM: 80 }, { desiredType: "sand", pumpMaxGPM: 120, debris: "high" },
    { desiredType: "de", debris: "low" }, { desiredType: "hybrid-de", pumpMaxGPM: 60, clarity: true }, { desiredType: "cartridge" }],
  newpool: [{ hasSWG: true }, { hasSWG: true, spa: true, spaJets: 8, gasHeater: true, debris: "high" }],
};
let runs = 0;
for (const gallons of [3000, 8000, 15000, 25000, 40000, 60000, 100000])
  for (const pipe of ["1.5", "2", "2.5+", "unknown"])
    for (const poolType of ["inground-plaster", "agp"])
      for (const climate of ["cool_temperate", "hot_sunny"])
        for (const [mode, vs] of Object.entries(variants))
          for (const v of vs) {
            const prof = { gallons, pipe, poolType, climate, automation: "none", ...v };
            runs++;
            let out;
            try { out = advisor.recommend(mode, structuredClone(prof)); }
            catch (e) { note(`${mode}: threw ${e.message}`, prof); continue; }
            const s = JSON.stringify(out);
            if (BAD.test(s)) note(`${mode}: NaN/undefined/Infinity in output`, prof, (s.match(/.{50}(NaN|undefined|Infinity).{30}/) || [])[0]);
            const recs = mode === "newpool" ? out.pump.recommendations : out.recommendations;
            if (!recs || !recs.length) note(`${mode}: no recommendations`, prof);
            if (mode === "newpool" && (!out.filt.recommendations.length || !out.swg.recommendations.length)) note("newpool: empty filter or salt plan", prof);
          }

const keys = Object.keys(problems);
for (const k of keys) console.log(`FAIL [${problems[k].n}x] ${k}\n  e.g. ${JSON.stringify(problems[k].prof)}${problems[k].detail ? "\n  " + problems[k].detail : ""}`);
console.log(`${runs} profiles swept, ${keys.length ? keys.length + " problem types" : "no problems"}`);
if (keys.length) process.exit(1);
