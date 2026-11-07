// Run every check the repository has, in order, and stop at the first failure.
//   node tools/check-all.mjs
// This is what CI runs on every push and pull request (.github/workflows/check.yml), and what to run
// before committing any data or logic change.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const steps = [
  ["data bundle is up to date", ["tools/build-data.mjs", "--check"]],
  ["catalog is valid", ["tools/check-catalog.mjs", "--quiet"]],
  ["golden cases", ["tests/run.mjs"]],
  ["input validation", ["tests/validation.mjs"]],
  ["robustness sweep", ["tests/sweep.mjs"]],
];
for (const [name, args] of steps) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const tail = (r.stdout + r.stderr).trim().split("\n").slice(-1)[0];
  if (r.status !== 0) {
    console.log(`FAIL  ${name}\n\n${(r.stdout + r.stderr).trim()}`);
    if (name === "golden cases") console.log("\nIf this change is intended, review it with: node tools/impact.mjs\nthen re-record with: node tests/run.mjs --update");
    process.exit(1);
  }
  console.log(`ok    ${name.padEnd(28)} ${tail}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log("\nall checks passed");
