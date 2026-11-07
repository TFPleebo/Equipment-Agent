// Apply manufacturer-spec verification findings to the filter or salt-cell catalog.
//
//   node tools/apply-specs.mjs sources/specs/filters-2026-11.json            # dry run: report only
//   node tools/apply-specs.mjs sources/specs/filters-2026-11.json --apply    # also writes data/
//
// A findings file lists, per catalog id, what the manufacturer's document says, its URL and a verdict
// (matches / corrected / conflict / unverified). See sources/specs/README.md. Rules:
//  - matches / corrected: source values are written to the record; src becomes the URL, asOf the
//    check date, dq "verified". Every changed value is listed in the report.
//  - conflict: values are left alone (the entry states which one the catalog keeps); src/asOf
//    record that it was checked; dq is not raised.
//  - unverified: nothing changes; the record is listed so a person can look it up.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [FILE] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
if (!FILE) { console.error("usage: node tools/apply-specs.mjs <findings.json> [--apply]"); process.exit(2); }
const findings = JSON.parse(readFileSync(join(root, FILE), "utf8"));
const kind = basename(FILE).startsWith("swg") ? "swg" : "filters";
const catPath = join(root, "data", kind + ".json");
const cat = JSON.parse(readFileSync(catPath, "utf8"));
// findings field -> catalog field
const MAP = kind === "filters"
  ? { area: "area", gpm: "gpm", psi: "psi", tank: "tank", bedSqFt: "bed", port: "port" }
  : { lbs: "lbs", rated: "rated", ctrl: "ctrl", ltCut: "ltCut", cell: "cell", fam: "fam" };

const changes = [], conflicts = [], unverified = [], unknown = [];
const out = cat.map((rec) => {
  const e = findings.entries[rec.id];
  if (!e) return rec;
  if (e.verdict === "unverified") { unverified.push({ rec, e }); return rec; }
  const next = { ...rec, src: e.src || rec.src, asOf: findings.checked };
  if (e.verdict === "conflict") { conflicts.push({ rec, e }); return next; }
  for (const [k, f] of Object.entries(MAP)) {
    if (e[k] === undefined) continue;
    // Sand filters: a bed area the source states replaces the tank-derived one.
    if (JSON.stringify(rec[f]) !== JSON.stringify(e[k])) { changes.push({ id: rec.id, field: f, from: rec[f], to: e[k], verdict: e.verdict, note: e.note }); next[f] = e[k]; }
  }
  next.dq = "verified";
  return next;
});
for (const id of Object.keys(findings.entries)) if (!cat.some((r) => r.id === id)) unknown.push(id);

const counts = {}; Object.values(findings.entries).forEach((e) => { counts[e.verdict] = (counts[e.verdict] || 0) + 1; });
const L = [`# ${kind === "filters" ? "Filter" : "Salt cell"} spec check (${findings.checked})`, "",
  `Findings: \`${basename(FILE)}\`. Mode: ${APPLY ? "**applied**" : "dry run (nothing written to data/)"}.`, "",
  `Verdicts: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}. Catalog records without a finding: ${cat.filter((r) => !findings.entries[r.id]).length}.`, "",
  "## Values changed", "", changes.length ? "| Record | Field | Was | Now | Why |\n|---|---|---|---|---|" : "none"];
for (const c of changes) L.push(`| \`${c.id}\` | ${c.field} | ${c.from ?? "-"} | ${c.to} | ${c.note || c.verdict} |`);
L.push("", "## Sources disagree (catalog value kept)", "");
for (const { rec, e } of conflicts) L.push(`- \`${rec.id}\`: ${e.note}`);
L.push("", "## Not verified (need a person to look up)", "");
for (const { rec, e } of unverified) L.push(`- \`${rec.id}\` ${rec.brand || rec.mfr} ${rec.model}: ${e.note || ""}`);
if (unknown.length) L.push("", "## Findings for ids not in the catalog (ignored)", "", unknown.map((x) => "- " + x).join("\n"));
mkdirSync(join(root, "reports"), { recursive: true });
const rp = join(root, "reports", `${kind}-specs-${findings.checked}.md`);
writeFileSync(rp, L.join("\n") + "\n");
console.log(`report: ${rp}\n${changes.length} values changed, ${conflicts.length} conflicts, ${unverified.length} unverified, ${unknown.length} unknown ids`);
if (APPLY) { writeFileSync(catPath, "[\n" + out.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n"); console.log(`data/${kind}.json written`); }
