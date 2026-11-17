import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { bar, openDemo, row } from "./util";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

test("AT-A1 axe-core reports no violations", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Check stock")).click();
  // Leave the chart so the hover chain highlight (X-1) does not dim other items.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400); // let the opacity transition finish
  // page.evaluate is not subject to the page CSP, so axe can be injected this way.
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: axe is injected at run time
    const axe = (window as any).axe;
    const r = await axe.run(document.querySelector(".fg-root"), {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
    });
    return r.violations.map(
      (v: { id: string; nodes: { target: string[]; failureSummary: string }[] }) =>
        `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary}`).join(" | ")}`,
    );
  });
  expect(result).toEqual([]);
});

function luminance(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const ratio = (a: string, b: string) => {
  const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

test("AT-A6 default tokens meet the contrast ratios", async ({ page }) => {
  await openDemo(page, "strict=0");
  // Plain bars without host content so the library defaults are measured.
  await page.evaluate(() =>
    window.__fg.setProps({
      renderBar: undefined,
      getItemStatus: (i) =>
        ({ order: "success", export: "warning", close: "pending", mail: "skipped", mrp: "running" })[i.id] as never,
    }),
  );
  await (await bar(page, "Login")).click();
  const samples = await page.evaluate(() => {
    const cs = (el: Element | null, pseudo?: string) => getComputedStyle(el!, pseudo ?? null);
    const out: { name: string; fg: string; bg: string; min: number }[] = [];
    for (const b of document.querySelectorAll<HTMLElement>(".fg-bar[data-kind='leaf']")) {
      const s = cs(b);
      out.push({
        name: `bar ${b.dataset.variant}/${b.dataset.status ?? "-"}`,
        fg: s.color,
        bg: s.backgroundColor,
        min: 4.5,
      });
    }
    const tbody = cs(document.querySelector(".fg-trow:not([data-selected='true'])")).backgroundColor;
    const surface = cs(document.querySelector(".fg-root")).backgroundColor;
    out.push({ name: "connector", fg: cs(document.querySelector(".fg-link-line")).stroke, bg: tbody, min: 3 });
    const handle = document.querySelector(".fg-handle");
    out.push({ name: "handle", fg: cs(handle, "::after").borderTopColor, bg: tbody, min: 3 });
    const toggle = cs(document.querySelector(".fg-toggle"));
    out.push({ name: "toggle icon", fg: toggle.color, bg: toggle.backgroundColor, min: 3 });
    const focus = cs(document.querySelector(".fg-root"));
    out.push({ name: "focus ring", fg: focus.outlineColor, bg: surface, min: 3 });
    const sel = cs(document.querySelector(".fg-row[data-selected='true']"));
    out.push({ name: "selected row text", fg: sel.color, bg: sel.backgroundColor, min: 4.5 });
    const header = cs(document.querySelector(".fg-grid-header"));
    out.push({ name: "header text", fg: header.color, bg: header.backgroundColor, min: 4.5 });
    return out;
  });
  const failures = samples
    .map((s) => ({ ...s, ratio: ratio(s.fg, s.bg) }))
    .filter((s) => s.ratio < s.min)
    .map((s) => `${s.name}: ${s.ratio.toFixed(2)} < ${s.min} (${s.fg} on ${s.bg})`);
  expect(samples.length).toBeGreaterThan(8);
  expect(failures).toEqual([]);
});

test("AT-A7 reduced motion disables transitions and animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDemo(page);
  await page.evaluate(() => window.__fg.setProps({ getItemStatus: (i) => (i.id === "mrp" ? "running" : undefined) }));
  await (await bar(page, "Run MRP")).hover();
  const offenders = await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of [document.querySelector(".fg-root")!, ...document.querySelectorAll(".fg-root *")]) {
      for (const pseudo of [null, "::after", "::before"]) {
        const s = getComputedStyle(el, pseudo);
        const t = s.transitionDuration.split(",").some((d) => Number.parseFloat(d) > 0);
        const a = s.animationName !== "none" && s.animationDuration.split(",").some((d) => Number.parseFloat(d) > 0);
        if (t || a) bad.push(`${(el as HTMLElement).className} ${pseudo ?? ""}`);
      }
    }
    return [...new Set(bad)];
  });
  expect(offenders).toEqual([]);
});

test("A11Y-3 focus is visible in both panes and the bar scrolls into view", async ({ page }) => {
  await openDemo(page);
  await row(page, "Setup").focus();
  await page.keyboard.press("End");
  const focused = page.locator(".fg-row:focus");
  await expect(focused).toHaveAttribute("aria-label", "Send summary mail");
  const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
  await expect(page.locator(".fg-trow[data-focused]")).toHaveCount(1);
  const b = await (await bar(page, "Send summary mail")).boundingBox();
  const view = await page.locator(".fg-scroller").boundingBox();
  expect(b!.x).toBeGreaterThanOrEqual(view!.x + 360);
  expect(b!.x + b!.width).toBeLessThanOrEqual(view!.x + view!.width);
});
