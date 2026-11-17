import { expect, test } from "@playwright/test";
import { bar, openDemo, row } from "./util";

// Every token from THEME-1 plus the additions recorded in docs/decisions.md.
const TOKENS = [
  "--fg-text-color",
  "--fg-surface",
  "--fg-border-color",
  "--fg-grid-line-color",
  "--fg-header-bg",
  "--fg-header-text-color",
  "--fg-row-bg",
  "--fg-row-alt-bg",
  "--fg-group-row-bg",
  "--fg-group-divider-color",
  "--fg-row-selected-bg",
  "--fg-group-row-selected-bg",
  "--fg-row-error-bg",
  "--fg-group-row-error-bg",
  "--fg-timeline-row-error-bg",
  "--fg-timeline-row-bg",
  "--fg-toggle-bg",
  "--fg-toggle-icon-color",
  "--fg-bar-default-bg",
  "--fg-bar-default-border",
  "--fg-bar-default-text",
  "--fg-bar-dependent-bg",
  "--fg-bar-dependent-border",
  "--fg-bar-dependent-text",
  "--fg-bar-delayed-bg",
  "--fg-bar-delayed-border",
  "--fg-bar-delayed-text",
  "--fg-bar-group-text",
  "--fg-bar-selected-ring",
  "--fg-group-frame-border",
  "--fg-group-frame-bg",
  "--fg-group-frame-header-bg",
  "--fg-link-color",
  "--fg-link-selected-color",
  "--fg-link-invalid-color",
  "--fg-handle-bg",
  "--fg-handle-border",
  "--fg-drop-valid-color",
  "--fg-drop-invalid-color",
  "--fg-focus-ring",
  "--fg-path-color",
  "--fg-preview-bg",
  "--fg-preview-border",
  "--fg-flash-color",
  "--fg-reorder-marker-color",
  "--fg-status-error-border",
  ...["warning", "success", "running", "pending", "skipped"].flatMap((s) =>
    ["bg", "border", "text"].map((k) => `--fg-status-${s}-${k}`),
  ),
];

test("AT-R13 every rendered colour comes from a --fg-* token", async ({ page }) => {
  await openDemo(page);
  const result = await page.evaluate((tokens) => {
    window.__fg.setProps({
      getItemStatus: (i) =>
        ({ stock: "error", setup: "error", mrp: "running", order: "success", close: "warning", export: "pending" })[
          i.id
        ] as never,
      highlightLongestPath: true,
    });
    const root = document.querySelector(".fg-root") as HTMLElement;
    const probe = document.createElement("div");
    document.body.append(probe);
    const allowed = new Set<string>(["rgba(0, 0, 0, 0)", "transparent"]);
    tokens.forEach((t, k) => {
      const value = `rgb(${(k * 37) % 250}, ${(k * 91 + 11) % 250}, ${(k * 53 + 101) % 250})`;
      root.style.setProperty(t, value);
      probe.style.color = value;
      allowed.add(getComputedStyle(probe).color);
    });
    probe.remove();
    return { allowedCount: allowed.size };
  }, TOKENS);
  expect(result.allowedCount).toBe(TOKENS.length + 2);
  // Select an item so selected styles render, then hover a bar so handles show.
  await row(page, "Login").click();
  await (await bar(page, "Login")).hover();
  const offenders = await page.evaluate((tokens) => {
    const root = document.querySelector(".fg-root") as HTMLElement;
    const allowed = new Set<string>(["rgba(0, 0, 0, 0)"]);
    for (const t of tokens) {
      const probe = document.createElement("div");
      probe.style.color = root.style.getPropertyValue(t);
      document.body.append(probe);
      allowed.add(getComputedStyle(probe).color);
      probe.remove();
    }
    const bad: string[] = [];
    const check = (el: Element, prop: string, value: string) => {
      for (const c of value.match(/rgba?\([^)]*\)/g) ?? []) {
        if (!allowed.has(c)) bad.push(`${el.className && String((el as HTMLElement).className)} ${prop} ${c}`);
      }
    };
    const els = [root, ...root.querySelectorAll("*")].filter((el) => !el.closest("[class^='demo-']"));
    for (const el of els) {
      for (const pseudo of [null, "::after"]) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo && cs.content === "none") continue;
        check(el, "color", cs.color);
        check(el, "background-color", cs.backgroundColor);
        for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
          if (cs[`border${side}Style`] !== "none" && Number.parseFloat(cs[`border${side}Width`]) > 0)
            check(el, `border-${side}`, cs[`border${side}Color`]);
        }
        if (cs.outlineStyle !== "none") check(el, "outline", cs.outlineColor);
        if (cs.boxShadow !== "none") check(el, "box-shadow", cs.boxShadow);
        if (el instanceof SVGElement) {
          if (cs.fill !== "none") check(el, "fill", cs.fill);
          if (cs.stroke !== "none") check(el, "stroke", cs.stroke);
        }
      }
    }
    return [...new Set(bad)];
  }, TOKENS);
  expect(offenders).toEqual([]);
});

test("AT-R14 a single-class host rule overrides the bar background", async ({ page }) => {
  await openDemo(page);
  const bg = await page.evaluate(() => {
    const sheet = [...document.styleSheets].find((s) => s.href);
    sheet!.insertRule(".fg-bar { background: rgb(1, 2, 3); }", sheet!.cssRules.length);
    return getComputedStyle(document.querySelector('.fg-bar[data-variant="dependent"]')!).backgroundColor;
  });
  expect(bg).toBe("rgb(1, 2, 3)");
});

test("AT-R3 and AT-R6 measured in the browser", async ({ page }) => {
  await openDemo(page);
  const r = await row(page, "Check stock").boundingBox();
  const b = await (await bar(page, "Check stock")).boundingBox();
  expect(r!.height).toBe(36);
  expect(b!.height).toBe(31);
  expect(Math.abs(b!.y - r!.y - (r!.y + 36 - (b!.y + 31)))).toBeLessThanOrEqual(1);
  const group = await row(page, "Setup").evaluate((el) => {
    const cs = getComputedStyle(el);
    return { weight: cs.fontWeight, top: cs.borderTopWidth };
  });
  expect(Number(group.weight)).toBeGreaterThanOrEqual(600);
  expect(group.top).toBe("1px");
  const grid = await page.locator(".fg-grid").boundingBox();
  expect(Math.round(grid!.width)).toBe(360);
});
