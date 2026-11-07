// Catalog validator: structure, allowed values and physical plausibility of data/*.json.
//   node tools/check-catalog.mjs            # errors fail (exit 1); warnings are listed
//   node tools/check-catalog.mjs --quiet    # only the summary and errors
// Errors = data the engine can't use correctly. Warnings = values worth a human look.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(root, "data", f), "utf8"));
const pumps = read("pumps.json"), swg = read("swg.json"), filters = read("filters.json"), brands = read("brands.json");
const quiet = process.argv.includes("--quiet");
const errors = [], warnings = [];
const err = (cat, id, msg) => errors.push(`${cat} ${id}: ${msg}`);
const warn = (cat, id, msg) => warnings.push(`${cat} ${id}: ${msg}`);
const num = (v) => typeof v === "number" && Number.isFinite(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function common(cat, list, brandKey) {
  const ids = new Set();
  for (const x of list) {
    if (!x.id || typeof x.id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(x.id)) err(cat, x.id, "id must be lowercase letters, digits, dashes or underscores");
    if (ids.has(x.id)) err(cat, x.id, "duplicate id"); ids.add(x.id);
    if (!x[brandKey] || !x.model) err(cat, x.id, `${brandKey} and model are required`);
    if (brands.aliases[x[brandKey]]) err(cat, x.id, `brand "${x[brandKey]}" should be "${brands.aliases[x[brandKey]]}" (data/brands.json)`);
    if (!x.src) err(cat, x.id, "src (where this record came from) is required");
    if (!x.asOf || !DATE.test(x.asOf)) err(cat, x.id, "asOf must be a YYYY-MM-DD date");
    if (x.status && !["active", "discontinued"].includes(x.status)) err(cat, x.id, "status must be active or discontinued");
    if (x.sameAs != null && !list.some((y) => y.id === x.sameAs)) err(cat, x.id, `sameAs "${x.sameAs}" is not an id in this catalog`);
    if (x.sameAs === x.id) err(cat, x.id, "sameAs points at itself");
  }
  return ids;
}

// ---------------- pumps ----------------
common("pump", pumps, "brand");
for (const p of pumps) {
  if (!["VS", "DS", "MS", "SS"].includes(p.st)) err("pump", p.id, `st must be VS/DS/MS/SS (got ${p.st})`);
  if (p.class && !["inground", "agp", "inflatable", "pond", "booster", "waterfall"].includes(p.class)) err("pump", p.id, `class ${p.class} not allowed`);
  for (const k of ["hi", "lo"]) {
    const pt = p[k];
    if (!pt || !Array.isArray(pt.g) || !Array.isArray(pt.w) || pt.g.length !== 3 || pt.w.length !== 3) { err("pump", p.id, `${k} must have g[3] and w[3] (curves A,B,C)`); continue; }
    if (!num(pt.rpm) || pt.rpm < 300 || pt.rpm > 4000) warn("pump", p.id, `${k}.rpm ${pt.rpm} outside 300-4000`);
    pt.g.forEach((g, i) => { if (g != null && (!num(g) || g <= 0 || g > 250)) err("pump", p.id, `${k}.g[${i}] ${g} implausible`); });
    pt.w.forEach((w, i) => { if (w != null && (!num(w) || w <= 0 || w > 6000)) err("pump", p.id, `${k}.w[${i}] ${w} implausible`); });
    // On a fixed system curve, flow must fall from C (least restrictive) to A to B.
    const [a, b, c] = pt.g; if ([a, b, c].every(num) && !(c >= a && a >= b)) warn("pump", p.id, `${k} flows should order C >= A >= B (got ${pt.g.join("/")})`);
  }
  if (p.hi && p.lo && Array.isArray(p.hi.g) && Array.isArray(p.lo.g)) {
    p.hi.g.forEach((g, i) => { if (num(g) && num(p.lo.g[i]) && p.lo.g[i] > g) err("pump", p.id, `low-speed flow above high-speed on curve ${"ABC"[i]}`); });
    p.hi.w.forEach((w, i) => { if (num(w) && num(p.lo.w[i]) && p.lo.w[i] > w) err("pump", p.id, `low-speed watts above high-speed on curve ${"ABC"[i]}`); });
    if (p.st === "VS" && p.lo.rpm === p.hi.rpm) err("pump", p.id, "variable-speed pump with identical low and high speed");
  }
  if (!num(p.thp) || p.thp <= 0 || p.thp > 8) warn("pump", p.id, `thp ${p.thp} outside 0-8`);
  if (p.hhp != null && (!num(p.hhp) || p.hhp <= 0 || p.hhp > 5)) err("pump", p.id, `hhp ${p.hhp} implausible`);
  if (p.wef != null && (!num(p.wef) || p.wef <= 0 || p.wef > 20)) warn("pump", p.id, `wef ${p.wef} outside 0-20`);
  if (p.st === "SS" && /(^|[^a-z])(2sp|two[- ]?speed)/i.test(p.model)) warn("pump", p.id, `labelled single-speed but the name suggests two-speed (${p.model})`);
}

// ---------------- salt cells ----------------
common("swg", swg, "mfr");
for (const s of swg) {
  if (!num(s.lbs) || s.lbs <= 0 || s.lbs > 10) err("swg", s.id, `lbs/day ${s.lbs} implausible`);
  if (s.rated != null) {
    if (!num(s.rated) || s.rated < 5000 || s.rated > 200000) err("swg", s.id, `rated gallons ${s.rated} implausible`);
    else { const per10k = s.lbs / (s.rated / 10000); if (per10k < 0.2 || per10k > 1.2) warn("swg", s.id, `${s.lbs} lb/day for ${s.rated} gal rated is unusual (${per10k.toFixed(2)} lb/day per 10k gal)`); }
  }
  if (s.ctrl != null && !["proportional", "duty-cycle"].includes(s.ctrl)) err("swg", s.id, `ctrl ${s.ctrl} not allowed`);
  if (!["verified", "verified-press-release", "base-only", "incomplete", "conflicting-sources", "advertised-output-disputed"].includes(s.dq)) err("swg", s.id, `dq ${s.dq} not allowed`);
  if (!Array.isArray(s.auto)) err("swg", s.id, "auto must be a list");
}

// ---------------- filters ----------------
common("filter", filters, "brand");
for (const f of filters) {
  if (!["cartridge", "sand", "de", "hybrid-de"].includes(f.ft)) { err("filter", f.id, `ft ${f.ft} not allowed`); continue; }
  if (f.ft === "sand") {
    if (!num(f.tank) || f.tank < 8 || f.tank > 48) err("filter", f.id, `sand tank ${f.tank}" implausible`);
    if (f.bed != null && num(f.tank)) { const geom = Math.PI * (f.tank / 24) ** 2; if (Math.abs(f.bed - geom) / geom > 0.25) warn("filter", f.id, `bed ${f.bed} sq ft vs ${geom.toFixed(2)} from a ${f.tank}" tank`); }
  } else if (!num(f.area) || f.area < 10 || f.area > 1000) err("filter", f.id, `area ${f.area} sq ft implausible`);
  if (f.gpm != null) {
    if (!num(f.gpm) || f.gpm < 10 || f.gpm > 300) err("filter", f.id, `gpm ${f.gpm} implausible`);
    else if (f.ft !== "sand" && num(f.area)) { const r = f.gpm / f.area; const lim = f.ft === "cartridge" ? [0.2, 1.1] : [1, 2.1]; if (r < lim[0] || r > lim[1]) warn("filter", f.id, `${r.toFixed(2)} GPM per sq ft is unusual for ${f.ft}`); }
  } else warn("filter", f.id, "no rated max flow (gpm)");
  if (f.port != null && ![1.5, 2, 2.5, 3].includes(f.port)) warn("filter", f.id, `port ${f.port}" unusual`);
  if (!["verified", "partial"].includes(f.dq)) err("filter", f.id, `dq ${f.dq} not allowed`);
}

// ---------------- report ----------------
const age = (list) => { const m = {}; list.forEach((x) => (m[x.src] = (m[x.src] || 0) + 1)); return Object.entries(m).map(([k, v]) => `${v} ${k}`).join(", "); };
console.log(`pumps ${pumps.length} (${age(pumps)}) | salt cells ${swg.length} (${age(swg)}) | filters ${filters.length} (${age(filters)})`);
if (!quiet) for (const w of warnings) console.log("warn  " + w);
for (const e of errors) console.log("ERROR " + e);
console.log(`${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exit(1);
