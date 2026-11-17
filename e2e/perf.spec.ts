// Performance checks (section 14). Thresholds are the spec numbers; CI runners are slower and
// noisier than the reference machine, so CI multiplies them (decision Q10: CI catches
// regressions, release measurements on the reference machine prove the PERF numbers).
import { expect, type Page, test } from "@playwright/test";
import { openDemo } from "./util";

const SLACK = process.env.CI ? 3 : 1;
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)]!;

async function mountTimed(page: Page, data: string) {
  await page.goto(`/?data=${data}&perf=1&strict=0`);
  await page.waitForFunction(() => window.__fg?.ready === true);
  return page.evaluate(() => window.__fg.mountTimed());
}

/** Synchronous script cost of programmatic 300 px scroll steps (render plus commit). */
async function scrollSteps(page: Page, axis: "x" | "y", steps: number) {
  return page.evaluate(
    async ({ axis, steps }) => {
      const el = document.querySelector(".fg-scroller") as HTMLElement;
      const times: number[] = [];
      for (let i = 0; i < steps; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const t0 = performance.now();
        if (axis === "y") el.scrollTop += 300;
        else el.scrollLeft += 300;
        window.__fg.flushSync(() => el.dispatchEvent(new Event("scroll")));
        times.push(performance.now() - t0);
      }
      return times;
    },
    { axis, steps },
  );
}

const nodes = (page: Page) => page.evaluate(() => document.querySelectorAll(".fg-root, .fg-root *").length);

for (const [name, data, firstLimit] of [
  ["AT-P1 600 rows", "600", 100],
  ["AT-P2 5,000 rows and 5,000 dependencies", "5000", 400],
] as const) {
  test(name, async ({ page }) => {
    const runs: number[] = [];
    for (let k = 0; k < 3; k++) runs.push(await mountTimed(page, data));
    const first = median(runs);
    const y = await scrollSteps(page, "y", 60);
    const x = await scrollSteps(page, "x", 40);
    const count = await nodes(page);
    console.log(
      `${name}: first render ${first.toFixed(1)} ms; vertical median ${median(y).toFixed(2)} p95 ${p95(y).toFixed(2)} ms; ` +
        `horizontal median ${median(x).toFixed(2)} p95 ${p95(x).toFixed(2)} ms; ${count} DOM nodes`,
    );
    expect(first).toBeLessThan(firstLimit * SLACK);
    for (const t of [y, x]) {
      expect(median(t)).toBeLessThan(6 * SLACK);
      expect(p95(t)).toBeLessThan(10 * SLACK);
    }
    expect(count).toBeLessThan(1500);
  });
}

test("PERF-5 one change re-renders in under 16 ms", async ({ page }) => {
  await openDemo(page, "data=600&strict=0");
  const times = await page.evaluate(async () => {
    const f = window.__fg;
    const t = (fn: () => void) => {
      const t0 = performance.now();
      f.flushSync(fn);
      return performance.now() - t0;
    };
    const out: Record<string, number> = {};
    await new Promise((r) => requestAnimationFrame(r));
    out.selection = t(() => f.setSelected(["g1-l2"]));
    await new Promise((r) => requestAnimationFrame(r));
    out.expansion = t(() => f.setCollapsed(["g0"]));
    await new Promise((r) => requestAnimationFrame(r));
    out.item = t(() =>
      f.setData((d) => ({ ...d, items: d.items.map((i) => (i.id === "g2-l1" ? { ...i, label: "Renamed" } : i)) })),
    );
    await new Promise((r) => requestAnimationFrame(r));
    out.dependency = t(() => f.setData((d) => ({ ...d, dependencies: d.dependencies.slice(1) })));
    return out;
  });
  console.log(`PERF-5: ${JSON.stringify(times)}`);
  for (const v of Object.values(times)) expect(v).toBeLessThan(16 * SLACK);
});

test("AT-P3 100 mount and unmount cycles leave nothing behind", async ({ page }) => {
  await openDemo(page, "strict=0");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  /** Detached DOM nodes and ResizeObserver objects in a heap snapshot, plus live counters. */
  const measure = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    await cdp.send("HeapProfiler.collectGarbage");
    const chunks: string[] = [];
    const onChunk = (e: { chunk: string }) => chunks.push(e.chunk);
    cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
    const snap = JSON.parse(chunks.join(""));
    const fields: string[] = snap.snapshot.meta.node_fields;
    const width = fields.length;
    const nameAt = fields.indexOf("name");
    const detAt = fields.indexOf("detachedness");
    let detached = 0;
    let observers = 0;
    for (let i = 0; i < snap.nodes.length; i += width) {
      const name: string = snap.strings[snap.nodes[i + nameAt]];
      if (detAt >= 0 && snap.nodes[i + detAt] === 2 && /^(HTML|SVG)/.test(name)) detached++;
      if (name === "ResizeObserver") observers++;
    }
    const { metrics: m } = await cdp.send("Performance.getMetrics");
    const get = (n: string) => m.find((x) => x.name === n)!.value;
    return { detached, observers, nodes: get("Nodes"), listeners: get("JSEventListeners") };
  };
  const cycle = (n: number) =>
    page.evaluate(async (count) => {
      for (let i = 0; i < count; i++) {
        window.__fg.flushSync(() => window.__fg.remount());
        await new Promise((r) => setTimeout(r, 0));
      }
    }, n);
  await cycle(5);
  const before = await measure();
  await cycle(100);
  await page.waitForTimeout(300);
  const after = await measure();
  console.log(`AT-P3: before ${JSON.stringify(before)} after ${JSON.stringify(after)}`);
  expect(after.detached).toBeLessThanOrEqual(before.detached);
  expect(after.observers).toBeLessThanOrEqual(before.observers);
  expect(after.listeners).toBeLessThanOrEqual(before.listeners + 5);
  expect(after.nodes).toBeLessThanOrEqual(before.nodes + 50);
});

test("AT-X9 strict CSP: render, select, pan and link with no violation", async ({ page }) => {
  const errors = await openDemo(page);
  const login = page.locator('.fg-row[aria-label="Export report"]');
  await page.evaluate(() => window.__fg.getHandle()?.scrollToItem("export", { align: "start" }));
  await login.click();
  const bar = page.locator(".fg-bar[data-selected='true']");
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width + 7, b.y + b.height / 2);
  await page.mouse.down();
  const target = (await page.locator(`.fg-bar[data-fg-bar="${10}"]`).boundingBox())!;
  await page.mouse.move(target.x + 20, target.y + 10, { steps: 10 });
  await page.mouse.up();
  const o = (await page.locator(".fg-tbody").boundingBox())!;
  await page.mouse.move(o.x + 1000, o.y + 500);
  await page.mouse.down();
  await page.mouse.move(o.x + 900, o.y + 500, { steps: 5 });
  await page.mouse.up();
  const created = await page.evaluate(() => window.__fg.events.filter((e) => e.type === "dependencyCreate").length);
  expect(created).toBe(1);
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
  );
  expect(violations).toEqual([]);
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});
