// SEC-4: every installed dependency must use an OSI-approved license.
// Usage: node scripts/check-licenses.mjs   (runs `pnpm licenses list --json`)
import { execSync } from "node:child_process";

const OSI = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "MPL-2.0",
  "BlueOak-1.0.0",
  "Zlib",
  "Python-2.0",
  "Unlicense",
]);

/** Accepts SPDX expressions made only of OSI licenses joined by OR/AND. */
const ok = (expr) =>
  expr
    .replace(/[()]/g, " ")
    .split(/\s+(?:OR|AND)\s+/)
    .every((part) => OSI.has(part.trim()));

const out = execSync("pnpm licenses list --json", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(out);
const bad = [];
let count = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  count += pkgs.length;
  if (!ok(license)) for (const p of pkgs) bad.push(`${p.name}@${p.versions?.join(",") ?? "?"}: ${license}`);
}
if (bad.length) {
  console.error(`Packages without an OSI-approved license:\n${bad.join("\n")}`);
  process.exit(1);
}
console.log(`License check passed for ${count} packages.`);
