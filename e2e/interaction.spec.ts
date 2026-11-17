import { expect, type Page, test } from "@playwright/test";
import { bar, clearEvents, events, openDemo, row, scroll, timelineOrigin } from "./util";

const selection = async (page: Page) => {
  const all = (await events(page, "selection")) as { ids: string[] }[];
  return all.at(-1)?.ids ?? [];
};

async function center(page: Page, label: string) {
  const b = await (await bar(page, label)).boundingBox();
  return { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2, box: b! };
}

/** Drags with intermediate steps so pointermove handlers see the movement. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
}

async function scrollToItem(page: Page, id: string) {
  await page.evaluate((i) => window.__fg.getHandle()?.scrollToItem(i, { align: "start" }), id);
  await page.waitForTimeout(50);
}

test("AT-I1 click and ctrl+click select, also read-only", async ({ page }) => {
  for (const ro of [false, true]) {
    await openDemo(page, ro ? "readonly=1" : "");
    await (await bar(page, "Login")).click();
    expect(await selection(page)).toEqual(["login"]);
    await row(page, "Run MRP").click({ modifiers: ["ControlOrMeta"] });
    expect(await selection(page)).toEqual(["login", "mrp"]);
    for (const l of ["Login", "Run MRP"]) {
      await expect(row(page, l)).toHaveAttribute("data-selected", "true");
      await expect(await bar(page, l)).toHaveAttribute("data-selected", "true");
      const shadow = await (await bar(page, l)).evaluate((el) => getComputedStyle(el).boxShadow);
      expect(shadow).not.toBe("none");
    }
    const trow = page.locator(".fg-trow[data-selected='true']");
    await expect(trow).toHaveCount(2);
  }
});

test("AT-I2 shift+click selects the visible range", async ({ page }) => {
  await openDemo(page);
  await row(page, "Login").click();
  await row(page, "Post invoice").click({ modifiers: ["Shift"] });
  expect(await selection(page)).toEqual(["login", "stock", "sales", "order", "invoice"]);
});

test("AT-I3 right-click on a selected bar keeps the selection", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Login")).click();
  await clearEvents(page);
  await (await bar(page, "Login")).click({ button: "right" });
  expect(await events(page, "selection")).toEqual([]);
  expect(await events(page, "contextmenu")).toEqual([{ type: "item", id: "login", area: "timeline" }]);
});

test("AT-I4 context menu targets and default prevention", async ({ page }) => {
  await openDemo(page);
  await page.evaluate(() => {
    const w = window as unknown as { __prevented: boolean[] };
    w.__prevented = [];
    document.addEventListener("contextmenu", (e) => w.__prevented.push(e.defaultPrevented));
  });
  const o = await timelineOrigin(page);
  // Vertical segment of Login -> Check stock at x = 412, between the two rows.
  await page.mouse.click(o.x + 412, o.y + 72, { button: "right" });
  await page.mouse.click(o.x + 1100, o.y + 600, { button: "right" });
  expect(await events(page, "contextmenu")).toEqual([
    { type: "dependency", id: "d1", area: "timeline" },
    { type: "empty", id: null, area: "timeline" },
  ]);
  const prevented = await page.evaluate(() => (window as unknown as { __prevented: boolean[] }).__prevented);
  expect(prevented).toEqual([true, false]);
});

test("AT-I5 dragging from a handle creates a dependency", async ({ page }) => {
  await openDemo(page);
  await scrollToItem(page, "export");
  await (await bar(page, "Export report")).click();
  await page.evaluate(() => {
    const w = window as unknown as { __canConnect: string[] };
    w.__canConnect = [];
    window.__fg.setProps({
      canConnect: (ctx) => {
        w.__canConnect.push(`${ctx.from.id}>${ctx.to.id}`);
        return (ctx.from.parentId ?? null) === (ctx.to.parentId ?? null);
      },
    });
  });
  const src = await center(page, "Export report");
  const handle = { x: src.box.x + src.box.width + 7, y: src.y };
  const tgt = await center(page, "Send summary mail");
  await drag(page, handle, tgt);
  await expect(await bar(page, "Send summary mail")).toHaveAttribute("data-drop", "valid");
  await page.mouse.up();
  const calls = await page.evaluate(() => (window as unknown as { __canConnect: string[] }).__canConnect);
  expect(calls).toContain("export>mail");
  expect(await events(page, "dependencyCreate")).toEqual([{ from: "export", to: "mail", type: "finish-to-start" }]);
});

test("AT-I6 the same-parent rule rejects a cross-parent link with invalid feedback", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Login")).click();
  const src = await center(page, "Login");
  const tgt = await center(page, "Run MRP");
  await drag(page, { x: src.box.x + src.box.width + 7, y: src.y }, tgt);
  await expect(await bar(page, "Run MRP")).toHaveAttribute("data-drop", "invalid");
  await page.mouse.up();
  expect(await events(page, "dependencyCreate")).toEqual([]);
});

test("AT-I7 a link that would create a cycle is refused", async ({ page }) => {
  await openDemo(page);
  await page.evaluate(() => window.__fg.setProps({ canConnect: () => true }));
  await scrollToItem(page, "export");
  await (await bar(page, "Send summary mail")).click();
  const src = await center(page, "Send summary mail");
  const tgt = await center(page, "Export report");
  await drag(page, { x: src.box.x + src.box.width + 7, y: src.y }, tgt);
  await expect(await bar(page, "Export report")).toHaveAttribute("data-drop", "invalid");
  await page.mouse.up();
  expect(await events(page, "dependencyCreate")).toEqual([]);
});

test("AT-I8 read-only shows no handles and drags on bars pan", async ({ page }) => {
  for (const ro of [true, false]) {
    await openDemo(page, ro ? "readonly=1" : "");
    await (await bar(page, "Login")).click();
    await expect(page.locator(".fg-handle")).toHaveCount(ro ? 0 : 2);
    const c = await center(page, "Run MRP");
    const before = await scroll(page);
    await drag(page, c, { x: c.x - 200, y: c.y });
    await page.mouse.up();
    const after = await scroll(page);
    expect(after.left - before.left).toBe(200);
    expect(await events(page, "dependencyCreate")).toEqual([]);
  }
});

test("AT-I9 panning empty background scrolls 1:1 and keeps the selection", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Login")).click();
  await clearEvents(page);
  const o = await timelineOrigin(page);
  const start = { x: o.x + 900, y: o.y + 500 };
  await drag(page, start, { x: start.x - 250, y: start.y });
  await page.mouse.up();
  expect((await scroll(page)).left).toBe(250);
  expect(await events(page, "selection")).toEqual([]);
});

test("AT-I10 ctrl+wheel zooms around the pointer", async ({ page }) => {
  await openDemo(page);
  const o = await timelineOrigin(page);
  await page.evaluate(() => {
    const el = document.querySelector(".fg-scroller") as HTMLElement;
    el.scrollLeft = 600;
  });
  const px = 500;
  const pointer = { x: o.x + 600 + px, y: o.y + 300 };
  const level = [100, 20, 10, 100 / 15, 100 / 30, 100 / 60];
  const ids = ["5min", "10min", "15min", "30min", "1h"];
  await page.mouse.move(pointer.x, pointer.y);
  for (let k = 0; k < ids.length; k++) {
    const s0 = (await scroll(page)).left;
    const units0 = (s0 + px - 100) / level[k]!;
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect.poll(async () => ((await events(page, "zoom")) as string[]).at(-1)).toBe(ids[k]);
    await page.waitForTimeout(50);
    const s1 = (await scroll(page)).left;
    const units1 = (s1 + px - 100) / level[k + 1]!;
    // Keeps the time under the pointer within one column (clamped scroll aside).
    if (s1 > 0) expect(Math.abs(units1 - units0)).toBeLessThanOrEqual(100 / level[k + 1]!);
    if (ids[k] === "5min") {
      expect((await (await bar(page, "Login")).boundingBox())!.width).toBeCloseTo(60, 0);
    }
  }
});

test("AT-I11 toggle collapses and expands without changing the selection", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Login")).click();
  await clearEvents(page);
  await row(page, "Setup").locator(".fg-toggle").click();
  await expect(row(page, "Login")).toHaveCount(0);
  await row(page, "Setup").locator(".fg-toggle").click();
  await expect(row(page, "Login")).toHaveCount(1);
  expect(await events(page, "collapsed")).toEqual([["setup"], []]);
  expect(await events(page, "selection")).toEqual([]);
});

test("AT-I12 double-click calls onItemDoubleClick", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Run MRP")).dblclick();
  expect(await events(page, "dblclick")).toEqual(["mrp"]);
});

test("AT-I13 reordering grid rows", async ({ page }) => {
  await openDemo(page);
  const order = await row(page, "Create sales order").boundingBox();
  const inv = await row(page, "Post invoice").boundingBox();
  await drag(page, { x: inv!.x + 100, y: inv!.y + 18 }, { x: order!.x + 100, y: order!.y + 4 });
  await expect(page.locator(".fg-reorder-marker[data-valid='true']")).toHaveCount(1);
  await page.mouse.up();
  expect(await events(page, "reorder")).toEqual([{ id: "invoice", newParentId: "sales", newIndex: 0 }]);
  await expect(row(page, "Post invoice")).toHaveAttribute("aria-posinset", "1");

  await clearEvents(page);
  const stock = await row(page, "Check stock").boundingBox();
  const close = await row(page, "Close period").boundingBox();
  await drag(page, { x: stock!.x + 100, y: stock!.y + 18 }, { x: close!.x + 100, y: close!.y + 4 });
  await expect(page.locator(".fg-reorder-marker[data-valid='false']")).toHaveCount(1);
  await page.mouse.up();
  expect(await events(page, "reorder")).toEqual([]);
});

test("AT-I14 switching read-only keeps scroll and shows handles", async ({ page }) => {
  await openDemo(page, "readonly=1");
  await (await bar(page, "Login")).click();
  await page.evaluate(() => {
    const el = document.querySelector(".fg-scroller") as HTMLElement;
    el.scrollLeft = 120;
  });
  await expect(page.locator(".fg-handle")).toHaveCount(0);
  await page.getByLabel("Edit").check();
  expect((await scroll(page)).left).toBe(120);
  await expect(page.locator(".fg-handle")).toHaveCount(2);
});

test("AT-I15 scrollToItem aligns the bar's top-left corner", async ({ page }) => {
  await openDemo(page, "data=600");
  await page.evaluate(() => window.__fg.getHandle()?.scrollToItem("g40-l8", { align: "start" }));
  await page.waitForTimeout(100);
  const b = await (await bar(page, "Job 369")).boundingBox();
  const view = await page.locator(".fg-tbody").evaluate((el) => {
    const s = el.closest(".fg-scroller")!.getBoundingClientRect();
    return { left: s.left + 360, top: s.top + 35, right: s.right, bottom: s.bottom };
  });
  expect(b!.x).toBeGreaterThanOrEqual(view.left);
  expect(b!.x).toBeLessThan(view.right);
  expect(b!.y).toBeGreaterThanOrEqual(view.top);
  expect(b!.y).toBeLessThan(view.bottom);
});

test("INT-15 dragging a connector near the edge auto-scrolls", async ({ page }) => {
  await openDemo(page);
  await (await bar(page, "Login")).click();
  const src = await center(page, "Login");
  const view = (await page.locator(".fg-scroller").boundingBox())!;
  await drag(page, { x: src.box.x + src.box.width + 7, y: src.y }, { x: view.x + view.width - 25, y: src.y });
  await page.waitForTimeout(400);
  const left = (await scroll(page)).left;
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(left).toBeGreaterThan(50);
  expect(await events(page, "dependencyCreate")).toEqual([]);
});
