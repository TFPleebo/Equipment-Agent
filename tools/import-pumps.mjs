// Pump catalog importer: California Energy Commission (CEC) "Dedicated-Purpose Pool Pumps" records
// -> data/pumps.json.
//
//   node tools/import-pumps.mjs --cec sources/cec/dppp-<date>.jsonl            # dry run: writes the diff report only
//   node tools/import-pumps.mjs --cec sources/cec/dppp-<date>.jsonl --apply    # also writes data/pumps.json
//
// The input is the JSON-lines file written by tools/cec/fetch-pumps.cjs (one CEC detail record per
// line, keyed by the CEC field labels). Rules:
//  - Measured values (flow/watts/rpm at each test point, WEF, THP, hydraulic HP, max head, speed
//    type, product group) always come from CEC. Display names, motor type and frame are kept from the
//    existing record when there is one.
//  - CEC tests on one system curve (curve C). Curves A and B are derived (rule PUMP_CURVE_DERIVATION):
//    parabolic pump curve through the test point and the published maximum head; watts from the
//    fixed+linear power model. Every derived record is marked abSrc.
//  - Hand corrections live in data/overrides/pumps.json and are applied last, so a re-import never
//    wipes them.
//  - Records are never deleted. CEC "archived" -> status "discontinued". Older catalog records for the
//    same model -> sameAs the current one. Catalog records CEC doesn't list are kept and reported.
//  - Never silent: every run writes reports/pumps-import-<date>.md with what would change.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CEC_FILE = opt("--cec"), APPLY = args.includes("--apply");
if (!CEC_FILE) { console.error("usage: node tools/import-pumps.mjs --cec <file.jsonl> [--apply]"); process.exit(2); }

const readJSON = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const brands = readJSON("data/brands.json");
const rules = readJSON("data/rules.json");
const D = rules.PUMP_CURVE_DERIVATION.value;
const overrides = existsSync(join(root, "data/overrides/pumps.json")) ? readJSON("data/overrides/pumps.json") : {};
const current = readJSON("data/pumps.json");
const cecRows = readFileSync(CEC_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const fileDate = (basename(CEC_FILE).match(/\d{4}-\d{2}-\d{2}/) || [new Date().toISOString().slice(0, 10)])[0];
const SRC = `CEC MAEDbS Dedicated-Purpose Pool Pumps, downloaded ${fileDate}`;

// ---------- helpers ----------
const num = (v) => { if (v == null || v === "" || v === "None") return null; const n = Number(String(v).replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const norm = (s) => String(s || "").toUpperCase().replace(/\(.*?\)/g, "").replace(/[^A-Z0-9]/g, "");
const slug = (s) => String(s).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const known = new Set(current.map((p) => p.brand));
const canonBrand = (b) => {
  const t = String(b || "").trim();
  if (brands.aliases[t]) return brands.aliases[t];
  const ci = [...known].find((k) => k.toLowerCase() === t.toLowerCase());
  return ci || t;
};
const ST = { VS: "VS", SS: "SS", TS: "DS", DS: "DS", MS: "MS" };
const classOf = (group) => {
  const g = String(group || "").toLowerCase();
  if (/booster/.test(g)) return "booster";
  if (/waterfall/.test(g)) return "waterfall";
  if (/integral/.test(g)) return "inflatable";
  if (/non-self-priming/.test(g)) return "agp";
  if (/self-priming/.test(g)) return "inground";
  return null;
};
const voltsOf = (model) => { const m = String(model).match(/\(([\d/ ]+)\s*V\)/i); return m ? m[1].split("/").map(Number).filter(Boolean) : null; };

// Curves A and B from one curve-C test point (rule PUMP_CURVE_DERIVATION).
function deriveABC(point, hmax, smax) {
  const { rpm, gpm: Qc, w: Wc } = point;
  const K = D.systemCurveK, a = D.powerFixedFraction;
  const H0 = hmax && smax ? hmax * (rpm / smax) ** 2 : null;
  const Hc = K.C * Qc * Qc;
  let QA, QB, how = "parabolic";
  if (H0 && H0 > Hc) {
    const kp = (H0 - Hc) / (Qc * Qc);
    QA = Math.sqrt(H0 / (kp + K.A)); QB = Math.sqrt(H0 / (kp + K.B));
  } else { QA = Qc * D.fallbackRatio.A; QB = Qc * D.fallbackRatio.B; how = "ratio"; }
  const W = (Q) => Wc * (a + (1 - a) * Q / Qc);
  return { pt: { rpm, g: [r2(QA), r2(QB), r2(Qc)], w: [r2(W(QA)), r2(W(QB)), r2(Wc)] }, how };
}

// ---------- CEC row -> catalog fields ----------
function fromCec(r) {
  const f = (label) => r[label];
  const brand = canonBrand(f("Brand"));
  const model = String(f("Model Number")).trim();
  const st = ST[String(f("Speed Configuration For Which The Pump Is Being Rated") || "").split(" ")[0]] || null;
  const hmax = num(f("Maximum Head (Feet)"));
  const max = { rpm: num(f("Speed At Maximum Rotating Speed (Rpm)")), gpm: num(f("Flow Rate At Maximum Rotating Speed (Gpm)")), w: num(f("Input Power At Maximum Rotating Speed (Watts)")) };
  const low = { rpm: num(f("Speed At The Low Flow Load Point (Rpm)")), gpm: num(f("Flow Rate At The Low Flow Load Point (Gpm)")), w: num(f("Input Power At The Low Flow Load Point (Watts)")) };
  const mid = { rpm: num(f("Speed At The High Flow Load Point (Rpm)")), gpm: num(f("Flow Rate At The High Flow Load Point (Gpm)")), w: num(f("Input Power At The High Flow Load Point (Watts)")) };
  const problems = [];
  if (!st) problems.push("no speed configuration");
  if (!(max.rpm && max.gpm && max.w)) problems.push("no maximum-speed test point");
  if (problems.length) return { problems, brand, model };
  const hi = deriveABC(max, hmax, max.rpm);
  // Single-speed pumps have one operating point. Others use the CEC low-flow point when present.
  const hasLow = st !== "SS" && low.rpm && low.gpm && low.w;
  const lo = hasLow ? deriveABC(low, hmax, max.rpm) : { pt: JSON.parse(JSON.stringify(hi.pt)), how: hi.how };
  const rec = {
    brand, st,
    thp: num(f("Dedicated-Purpose Pool Pump Total Horsepower (Hp)")),
    nhp: num(f("Dedicated-Purpose Pool Pump Nominal Motor Horsepower (Hp)")),
    hhp: num(f("Rated Hydraulic Horsepower (Hp)")),
    wef: num(f("Weighted Energy Factor (Kgal/Kwh)")),
    hmax, hi: hi.pt, lo: lo.pt,
    abSrc: hi.how === "parabolic" && lo.how === "parabolic" ? "derived-parabolic" : "derived-ratio",
    class: classOf(f("Dedicated-Purpose Pool Pump Product Group")),
    status: r._status === "archived" ? "discontinued" : "active",
    src: SRC, asOf: fileDate,
    cec: { model, brand: f("Brand"), added: f("Add Date"), group: f("Dedicated-Purpose Pool Pump Product Group") },
  };
  if (mid.rpm && mid.gpm && mid.w && st === "VS") rec.mid = { rpm: mid.rpm, gpm: mid.gpm, w: mid.w };
  const v = voltsOf(model); if (v) rec.volts = v;
  return { rec, brand, model, key: brand + "|" + norm(model) };
}

// ---------- match CEC rows to existing records ----------
const byCecKey = new Map(), tokenIndex = new Map();
for (const p of current) {
  if (p.cec) byCecKey.set(canonBrand(p.cec.brand) + "|" + norm(p.cec.model), p);
  for (const t of new Set((p.model + " " + p.id.replace(/-/g, " ")).split(/\s+/).map(norm).filter((t) => t.length >= 4))) {
    if (!tokenIndex.has(t)) tokenIndex.set(t, []); tokenIndex.get(t).push(p);
  }
}
const closeness = (p, rec) => Math.abs((p.hi.g[2] || 0) - rec.hi.g[2]) + Math.abs((p.hi.w[2] || 0) - rec.hi.w[2]) / 50;

const parsed = [], rejected = [];
for (const r of cecRows) { const x = fromCec(r); (x.problems ? rejected : parsed).push(x); }
// The same brand+model can be listed twice (approved and archived): keep the approved listing.
const byKey = new Map();
for (const x of parsed) { const prev = byKey.get(x.key); if (!prev || (prev.rec.status === "discontinued" && x.rec.status === "active")) byKey.set(x.key, x); }

const out = new Map(current.map((p) => [p.id, p]));
const claimed = new Set(), report = { added: [], updated: [], unchanged: 0, sameAs: [], rejected, unmatchedLegacy: [] };
const usedIds = new Set(current.map((p) => p.id));
for (const x of byKey.values()) {
  let match = byCecKey.get(x.key);
  let candidates = [];
  if (!match) {
    candidates = (tokenIndex.get(norm(x.model)) || []).filter((p) => !p.cec);
    const sameBrand = candidates.filter((p) => p.brand === x.brand);
    if (sameBrand.length) candidates = sameBrand;
    candidates.sort((a, b) => closeness(a, x.rec) - closeness(b, x.rec));
    match = candidates.find((p) => !claimed.has(p.id));
  }
  let id;
  if (match) {
    id = match.id; claimed.add(id);
    const merged = { id, brand: x.rec.brand, model: match.model, mot: match.mot ?? null, frame: match.frame ?? null, dq: "ok", ...x.rec };
    const before = JSON.stringify(stripMeta(match)), after = JSON.stringify(stripMeta(merged));
    if (before !== after) report.updated.push({ id, before: match, after: merged }); else report.unchanged++;
    out.set(id, merged);
    // Other catalog records for the same model are older certifications of it.
    for (const other of candidates) if (other.id !== id && !claimed.has(other.id)) {
      claimed.add(other.id); out.set(other.id, { ...other, sameAs: id }); report.sameAs.push({ id: other.id, to: id });
    }
  } else {
    id = slug(x.brand + "-" + x.model); let n = 2; while (usedIds.has(id)) id = slug(x.brand + "-" + x.model) + "-" + n++;
    usedIds.add(id);
    const rec = { id, brand: x.rec.brand, model: x.model, mot: null, frame: null, dq: "ok", ...x.rec };
    out.set(id, rec); report.added.push(rec);
  }
}
for (const p of current) if (!claimed.has(p.id) && !p.cec) report.unmatchedLegacy.push(p);

// ---------- hand corrections last ----------
const overrideNotes = [];
for (const [id, fields] of Object.entries(overrides)) {
  if (id.startsWith("_")) continue;
  const p = out.get(id); if (!p) { overrideNotes.push(`override for unknown id ${id} (ignored)`); continue; }
  out.set(id, { ...p, ...fields });
}
function stripMeta(p) { const { src, asOf, ...rest } = p; return rest; }

// ---------- report ----------
const result = [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
const fmtPt = (pt) => pt ? `${pt.g[2]} GPM / ${pt.w[2]} W @ ${pt.rpm}` : "-";
const changedFields = (a, b) => ["st", "thp", "wef", "hhp", "class", "status"].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${a[k] ?? "-"} -> ${b[k] ?? "-"}`)
  .concat(JSON.stringify(a.hi?.g?.[2]) !== JSON.stringify(b.hi?.g?.[2]) || JSON.stringify(a.hi?.w?.[2]) !== JSON.stringify(b.hi?.w?.[2]) ? [`max speed C: ${fmtPt(a.hi)} -> ${fmtPt(b.hi)}`] : [])
  .concat(JSON.stringify(a.lo?.g?.[2]) !== JSON.stringify(b.lo?.g?.[2]) ? [`low point C: ${fmtPt(a.lo)} -> ${fmtPt(b.lo)}`] : []);
const cnt = (arr, f) => { const m = {}; arr.forEach((x) => { const k = f(x); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "); };
const L = [];
L.push(`# Pump import report (${fileDate})`, "", `Source: \`${basename(CEC_FILE)}\` (${cecRows.length} CEC records, ${byKey.size} distinct brand+model). Mode: ${APPLY ? "**applied**" : "dry run (nothing written to data/)"}.`, "");
L.push("| | Count |", "|---|---|",
  `| Catalog before | ${current.length} |`, `| Catalog after | ${result.length} |`,
  `| Updated from CEC (existing ids kept) | ${report.updated.length} |`, `| Already identical | ${report.unchanged} |`,
  `| Added (new to the catalog) | ${report.added.length} |`, `| Marked sameAs (older certification of another record) | ${report.sameAs.length} |`,
  `| Discontinued (CEC archived) | ${result.filter((p) => p.status === "discontinued").length} |`,
  `| Catalog records CEC doesn't list (kept, legacy data) | ${report.unmatchedLegacy.length} |`, `| CEC records skipped (incomplete) | ${rejected.length} |`, "");
L.push("## Added, by brand", "", cnt(report.added, (p) => p.brand) || "none", "");
L.push("## Added, by class", "", cnt(report.added, (p) => p.class), "");
L.push("## Updated records: what changed", "", "Only fields that changed are listed. Curves A/B are always re-derived and not listed.", "");
for (const u of report.updated) { const c = changedFields(u.before, u.after); if (c.length) L.push(`- \`${u.id}\` (${u.after.model}): ${c.join("; ")}`); }
L.push("", "## Marked sameAs", "");
for (const s of report.sameAs) L.push(`- \`${s.id}\` -> \`${s.to}\``);
L.push("", "## Catalog records CEC doesn't list", "", "Kept unchanged (src legacy-2026-07). Usually pre-2021 models no longer certified, or names that didn't match a CEC model number; check the list for typos.", "");
L.push(cnt(report.unmatchedLegacy, (p) => p.brand), "");
for (const p of report.unmatchedLegacy) L.push(`- \`${p.id}\` ${p.brand} ${p.model} (${p.st})`);
if (rejected.length) { L.push("", "## Skipped CEC records", ""); for (const x of rejected) L.push(`- ${x.brand} ${x.model}: ${x.problems.join(", ")}`); }
if (overrideNotes.length) { L.push("", "## Overrides", ""); overrideNotes.forEach((n) => L.push("- " + n)); }
mkdirSync(join(root, "reports"), { recursive: true });
const reportPath = join(root, "reports", `pumps-import-${fileDate}.md`);
writeFileSync(reportPath, L.join("\n") + "\n");
console.log(`report: ${reportPath}`);
console.log(`before ${current.length}, after ${result.length}: updated ${report.updated.length}, unchanged ${report.unchanged}, added ${report.added.length}, sameAs ${report.sameAs.length}, unmatched legacy ${report.unmatchedLegacy.length}, skipped ${rejected.length}`);
if (APPLY) {
  writeFileSync(join(root, "data/pumps.json"), "[\n" + result.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n");
  console.log("data/pumps.json written. Next: node tools/build-data.mjs && node tools/check-all.mjs");
}
