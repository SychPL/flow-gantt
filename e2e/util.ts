import type { Page } from "@playwright/test";

/** Opens the demo and waits until the chart rows are rendered. Fails on CSP violations. */
export async function openDemo(page: Page, query = ""): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") violations.push(msg.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      const w = window as unknown as { __cspViolations?: string[] };
      w.__cspViolations = [...(w.__cspViolations ?? []), `${e.violatedDirective} ${e.blockedURI}`];
    });
  });
  await page.goto(`/${query ? `?${query}` : ""}`);
  await page.locator('.fg-row[role="row"]').first().waitFor();
  return violations;
}

export const row = (page: Page, label: string) => page.locator(`.fg-row[role="row"][aria-label="${label}"]`);

/** The bar of the item with this label (same row index as its grid row). */
export async function bar(page: Page, label: string) {
  const r = await row(page, label).getAttribute("data-fg-row");
  return page.locator(`.fg-bar[data-fg-bar="${r}"]`);
}

export async function box(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return b;
}

export async function events(page: Page, type?: string) {
  const all = await page.evaluate(() => window.__fg.events);
  return type ? all.filter((e) => e.type === type).map((e) => e.payload) : all;
}

export async function clearEvents(page: Page) {
  await page.evaluate(() => {
    window.__fg.events.length = 0;
  });
}

export async function scroll(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".fg-scroller") as HTMLElement;
    return { left: el.scrollLeft, top: el.scrollTop };
  });
}

/** Timeline content origin on screen: client coordinates of timeline x=0, body y=0. */
export async function timelineOrigin(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector(".fg-tbody") as HTMLElement;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
}
