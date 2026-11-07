// Input-validation tests for recommend() (rule INPUT_SCHEMA).
//   node tests/validation.mjs
// Checks that bad input fails with a clear error list and that lenient fixes
// (text numbers, clamping, defaults, unknown ids) are applied and reported.
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

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log("ok   " + name); }
  catch (e) { fail++; console.log("FAIL " + name + "\n  " + e.message); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const errorsOf = (mode, profile) => {
  try { advisor.recommend(mode, profile); return null; } catch (e) { return e.errors || [e.message]; }
};

check("missing gallons is an error", () => {
  const e = errorsOf("swg", {});
  assert(e && e.some((x) => /gallons is required/.test(x)), JSON.stringify(e));
});
check("unknown mode and out-of-range gallons are both reported", () => {
  const e = errorsOf("spa", { gallons: 1 });
  assert(e && e.length === 2, JSON.stringify(e));
});
check("unknown enum value is an error listing the allowed values", () => {
  const e = errorsOf("swg", { gallons: 20000, climate: "tropical" });
  assert(e && /cool_temperate, warm, hot_sunny/.test(e[0]), JSON.stringify(e));
});
check("numbers sent as text are converted and noted", () => {
  const r = advisor.recommend("pump", { gallons: "20000", pipe: "2" });
  assert(r.recommendations.length > 0, "no recommendations");
  assert(r.inputNotes.some((n) => /gallons converted/.test(n)), JSON.stringify(r.inputNotes));
});
check("runtime outside 1-24 is clamped and noted", () => {
  const r = advisor.recommend("swg", { gallons: 20000, runtime: 30 });
  assert(r.runtime === 24, "runtime " + r.runtime);
  assert(r.inputNotes.some((n) => /runtime 30/.test(n)), JSON.stringify(r.inputNotes));
});
check("unknown catalog id is ignored and noted", () => {
  const r = advisor.recommend("pump", { gallons: 20000, pipe: "2", currentPumpId: "no-such-pump" });
  assert(r.comparison === null, "comparison should be null");
  assert(r.inputNotes.some((n) => /not in the pumps catalog/.test(n)), JSON.stringify(r.inputNotes));
});
check("filter mode assumes pump max flow from pipe size", () => {
  const r = advisor.recommend("filter", { gallons: 20000, pipe: "2" });
  assert(r.pumpMaxGPM === 80, "pumpMaxGPM " + r.pumpMaxGPM);
  assert(r.recommendations.length > 0, "no recommendations");
});
check("mode-specific defaults are not applied to other modes", () => {
  const r = advisor.recommend("filter", { gallons: 20000, pipe: "2" });
  assert(!(r.inputNotes || []).some((n) => /voltage|climate/.test(n)), JSON.stringify(r.inputNotes));
});
check("the caller's profile object is not modified", () => {
  const prof = { gallons: "20000" };
  advisor.recommend("swg", prof);
  assert(prof.gallons === "20000" && Object.keys(prof).length === 1, JSON.stringify(prof));
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
