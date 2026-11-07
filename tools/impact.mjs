// What would a data or logic change do to the recommendations? Compares the engine's current
// answers for every golden case (tests/cases) with the answers recorded there, in plain words.
//   node tools/impact.mjs              # print to the terminal
//   node tools/impact.mjs --md FILE    # also write a Markdown report (e.g. for a PR description)
// Run it after an import or rule change and before `node tests/run.mjs --update`, so a change in
// what people are told to buy is reviewed, not just re-recorded.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createAdvisor } = require(join(root, "engine/advisor.js"));
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const data = { pumps: read("data/pumps.json"), swg: read("data/swg.json"), filters: read("data/filters.json"), rules: read("data/rules.json"), meta: read("data/meta.json") };
const advisor = createAdvisor(data);
const { summarize } = await import(join(root, "tests/summarize.mjs"));
const name = (id) => { const x = data.pumps.find((p) => p.id === id) || data.swg.find((s) => s.id === id) || data.filters.find((f) => f.id === id); return x ? `${x.brand || x.mfr} ${x.model}` : id; };

const lines = []; let changed = 0, total = 0;
for (const file of readdirSync(join(root, "tests/cases")).filter((f) => f.endsWith(".json")).sort()) {
  const c = read("tests/cases/" + file); total++;
  const now = summarize(c.mode, JSON.parse(JSON.stringify(advisor.recommend(c.mode, structuredClone(c.profile)))));
  if (isDeepStrictEqual(now, c.expect)) continue;
  changed++;
  lines.push(`### ${c.title}`);
  for (const k of Object.keys({ ...c.expect, ...now })) {
    const a = c.expect?.[k], b = now[k];
    if (isDeepStrictEqual(a, b)) continue;
    if (Array.isArray(a) && Array.isArray(b) && /top|Top/.test(k)) {
      lines.push(`- **${k}**: #1 ${a[0] === b[0] ? "unchanged" : `${name(a[0])} -> **${name(b[0])}**`}; new in list: ${b.filter((x) => !a.includes(x)).map(name).join(", ") || "none"}; dropped: ${a.filter((x) => !b.includes(x)).map(name).join(", ") || "none"}`);
    } else if (Array.isArray(a) && Array.isArray(b)) {
      lines.push(`- **${k}**: added ${b.filter((x) => !a.includes(x)).join(", ") || "none"}; removed ${a.filter((x) => !b.includes(x)).join(", ") || "none"}`);
    } else lines.push(`- **${k}**: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  lines.push("");
}
const head = `# Recommendation impact\n\n${changed} of ${total} golden cases would change.\n`;
console.log(head + "\n" + lines.join("\n"));
const mi = process.argv.indexOf("--md");
if (mi > 0) writeFileSync(process.argv[mi + 1], head + "\n" + lines.join("\n") + "\n");
