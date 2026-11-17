import { expect, test } from "@playwright/test";
import { referenceExample } from "../fixtures/data";
import { computeLayout } from "../src/layout";
import { bar, events, openDemo } from "./util";

const left = async (page: import("@playwright/test").Page, label: string) =>
  Number.parseFloat((await (await bar(page, label)).getAttribute("style"))!.match(/left: ([\d.]+)px/)![1]!);

test("AT-X5 running stripe moves, and is static under reduced motion", async ({ page }) => {
  for (const reduce of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduce ? "reduce" : "no-preference" });
    await openDemo(page);
    await page.evaluate(() => window.__fg.setProps({ getItemStatus: (i) => (i.id === "mrp" ? "running" : undefined) }));
    const anim = await (await bar(page, "Run MRP")).evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe(reduce ? "none" : "fg-stripe");
  }
});

test("AT-X6 layout changes animate to the AT-L2 positions", async ({ page }) => {
  await openDemo(page);
  expect(await left(page, "Check stock")).toBe(450);
  const mid = await page.evaluate(async () => {
    window.__fg.setData((d) => ({ ...d, dependencies: d.dependencies.filter((x) => x.id !== "d1") }));
    await new Promise((r) => setTimeout(r, 60));
    const r = document.querySelector('.fg-row[aria-label="Check stock"]')!.getAttribute("data-fg-row");
    return Number.parseFloat((document.querySelector(`.fg-bar[data-fg-bar="${r}"]`) as HTMLElement).style.left);
  });
  expect(mid).toBeGreaterThan(100);
  expect(mid).toBeLessThan(450);
  await page.waitForTimeout(300);
  // AT-L2: Check stock 0-3, Sales flow 3.5-10.
  expect(await left(page, "Check stock")).toBe(100);
  expect(await left(page, "Sales flow")).toBe(450);

  // Reduced motion: no animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDemo(page);
  const immediate = await page.evaluate(async () => {
    window.__fg.flushSync(() =>
      window.__fg.setData((d) => ({ ...d, dependencies: d.dependencies.filter((x) => x.id !== "d1") })),
    );
    await new Promise((r) => requestAnimationFrame(r));
    const r = document.querySelector('.fg-row[aria-label="Check stock"]')!.getAttribute("data-fg-row");
    return Number.parseFloat((document.querySelector(`.fg-bar[data-fg-bar="${r}"]`) as HTMLElement).style.left);
  });
  expect(immediate).toBe(100);
});

test("X-6 more than 500 moving bars jump immediately", async ({ page }) => {
  await openDemo(page, "data=600");
  const before = await left(page, "Job 2");
  const after = await page.evaluate(async () => {
    window.__fg.flushSync(() => window.__fg.setProps({ defaultSpan: 5 }));
    await new Promise((r) => requestAnimationFrame(r));
    const r = document.querySelector('.fg-row[aria-label="Job 2"]')!.getAttribute("data-fg-row");
    return Number.parseFloat((document.querySelector(`.fg-bar[data-fg-bar="${r}"]`) as HTMLElement).style.left);
  });
  expect(after).not.toBe(before);
  await page.waitForTimeout(250);
  expect(await left(page, "Job 2")).toBe(after);
});

test("AT-X7 dependency preview shows ghost bars and leaves no trace when cancelled", async ({ page }) => {
  await openDemo(page);
  await page.evaluate(() => window.__fg.setProps({ canConnect: () => true }));
  const mrp = await bar(page, "Run MRP");
  await mrp.click();
  const b = (await mrp.boundingBox())!;
  const target = (await (await bar(page, "Setup")).boundingBox())!;
  const sales = (await (await bar(page, "Sales flow")).boundingBox())!;
  await page.mouse.move(b.x + b.width + 7, b.y + b.height / 2);
  await page.mouse.down();
  // Spec case: Run MRP -> Sales flow changes no position, so only the target's ghost shows.
  await page.mouse.move(sales.x + 30, sales.y + sales.height / 2, { steps: 10 });
  const salesRow = await page.locator('.fg-row[aria-label="Sales flow"]').getAttribute("data-fg-row");
  await expect(page.locator(".fg-ghost")).toHaveCount(1);
  await expect(page.locator(`.fg-ghost[data-ghost-row="${salesRow}"]`)).toHaveAttribute("style", /left: 800px/);
  await page.mouse.move(target.x + 30, target.y + target.height / 2, { steps: 10 });
  await expect(await bar(page, "Setup")).toHaveAttribute("data-drop", "valid");
  // Expected positions from computeLayout with the hypothetical dependency.
  const ex = referenceExample();
  const hyp = computeLayout({ ...ex, dependencies: [...ex.dependencies, { id: "x", from: "mrp", to: "setup" }] });
  const ghosts = await page.locator(".fg-ghost").evaluateAll((els) =>
    els.map((el) => ({
      row: Number((el as HTMLElement).dataset.ghostRow),
      left: Number.parseFloat((el as HTMLElement).style.left),
    })),
  );
  const order = ex.items.map((i) => i.id);
  const expected = ["setup", "login", "stock", "sales", "order", "invoice", "month", "export", "close", "mail"].map(
    (id) => ({ row: order.indexOf(id), left: 100 + hyp.entries.get(id)!.startUnits * 100 }),
  );
  expect(ghosts.sort((a, c) => a.row - c.row)).toEqual(expected);
  // Release over empty space: ghosts go away, nothing is created.
  const o = (await page.locator(".fg-tbody").boundingBox())!;
  await page.mouse.move(o.x + 1200, o.y + 700, { steps: 5 });
  await expect(page.locator(".fg-ghost")).toHaveCount(0);
  await page.mouse.up();
  expect(await events(page, "dependencyCreate")).toEqual([]);
});
