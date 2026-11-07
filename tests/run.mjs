// Golden tests for the sizing engine.
//
//   node tests/run.mjs            # check every case in tests/cases/
//   node tests/run.mjs --update   # re-record expectations after an intended change
//
// Each case file holds an input profile and an "expect" block: the headline
// numbers, the top-ranked model ids and the warning codes. This is the
// contract: any rebuild of the advisor (e.g. inside PoolMath) should produce
// the same "expect" block for the same profile. tests/snapshots/ additionally
// keeps the full engine output so any change at all to wording or ranking
// is caught here.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { summarize } from "./summarize.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createAdvisor } = require(join(root, "engine/advisor.js"));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const data = {
  pumps: read("data/pumps.json"), swg: read("data/swg.json"), filters: read("data/filters.json"),
  rules: read("data/rules.json"), meta: read("data/meta.json"),
};
const advisor = createAdvisor(data);

const update = process.argv.includes("--update");
const casesDir = join(root, "tests/cases"), snapDir = join(root, "tests/snapshots");
mkdirSync(snapDir, { recursive: true });
let pass = 0, fail = 0;
for (const file of readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()) {
  const c = JSON.parse(readFileSync(join(casesDir, file), "utf8"));
  const out = JSON.parse(JSON.stringify(advisor.recommend(c.mode, structuredClone(c.profile))));
  const got = summarize(c.mode, out);
  const snapPath = join(snapDir, file);
  if (update) {
    c.expect = got;
    writeFileSync(join(casesDir, file), JSON.stringify(c, null, 2) + "\n");
    writeFileSync(snapPath, JSON.stringify(out, null, 1) + "\n");
    continue;
  }
  const problems = [];
  if (!isDeepStrictEqual(got, c.expect)) problems.push("expect block differs:\n    want " + JSON.stringify(c.expect) + "\n    got  " + JSON.stringify(got));
  let snap = null;
  try { snap = JSON.parse(readFileSync(snapPath, "utf8")); } catch { problems.push("missing snapshot " + snapPath); }
  if (snap && !isDeepStrictEqual(out, snap)) problems.push("full output differs from tests/snapshots/" + file);
  if (problems.length) { fail++; console.log("FAIL " + c.id + " - " + c.title + "\n  " + problems.join("\n  ")); }
  else { pass++; console.log("ok   " + c.id); }
}
if (update) console.log("updated expectations and snapshots");
else { console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1); }
