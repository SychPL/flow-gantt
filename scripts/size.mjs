// PERF-7: minified and gzipped size of the JavaScript entries and of the CSS file.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { build } from "vite";

const out = mkdtempSync(join(tmpdir(), "fg-size-"));
try {
  await build({
    configFile: "vite.lib.config.ts",
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true, minify: true, sourcemap: false },
  });
  const js = readdirSync(out).filter((f) => f.endsWith(".js"));
  const jsGz = js.reduce((n, f) => n + gzipSync(readFileSync(join(out, f))).length, 0);
  const cssGz = gzipSync(readFileSync("src/styles.css")).length;
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  console.log(`JS (all entries, min+gz): ${kb(jsGz)} (limit 40 kB); CSS (gz): ${kb(cssGz)} (limit 8 kB)`);
  if (jsGz > 40 * 1024 || cssGz > 8 * 1024) {
    console.error("PERF-7 size budget exceeded");
    process.exitCode = 1;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
