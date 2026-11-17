// PERF-2 / AT-L9 benchmark on the built package: computeLayout for 5,000 items and 5,000 dependencies.
// Usage: node scripts/bench-layout.mjs [--max-ms 20]
import { computeLayout } from "../dist/layout.js";
import { large5000 } from "../fixtures/data.ts";

const arg = process.argv.indexOf("--max-ms");
const maxMs = arg > 0 ? Number(process.argv[arg + 1]) : 20;
const data = large5000();
for (let i = 0; i < 10; i++) computeLayout(data);
const times = [];
for (let i = 0; i < 30; i++) {
  const t = performance.now();
  computeLayout(data);
  times.push(performance.now() - t);
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
const p95 = times[Math.floor(times.length * 0.95)];
console.log(`computeLayout 5000/5000: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (limit ${maxMs} ms)`);
if (median > maxMs) {
  console.error("PERF-2 regression: median above limit");
  process.exit(1);
}
