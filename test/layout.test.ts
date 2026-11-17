import { describe, expect, it } from "vitest";
import { large5000, referenceExample } from "../fixtures/data";
import {
  computeLayout,
  type FlowDependency,
  type FlowItem,
  getPredecessors,
  getSuccessors,
  validate,
  wouldCreateCycle,
} from "../src/layout";
import { removeDependency, removeItems } from "../src/ops";

const units = (layout: ReturnType<typeof computeLayout>) =>
  Object.fromEntries([...layout.entries].map(([id, e]) => [id, [e.startUnits, e.endUnits]]));

describe("computeLayout", () => {
  it("AT-L1 lays out the reference example", () => {
    const ex = referenceExample();
    const layout = computeLayout(ex);
    expect(units(layout)).toEqual({
      setup: [0, 6.5],
      login: [0, 3],
      stock: [3.5, 6.5],
      sales: [7, 13.5],
      order: [7, 10],
      invoice: [10.5, 13.5],
      mrp: [0, 3],
      month: [14, 24],
      export: [14, 17],
      close: [17.5, 20.5],
      mail: [21, 24],
    });
    expect(layout.minUnits).toBe(0);
    expect(layout.maxUnits).toBe(24);
    expect(layout.errors).toEqual([]);
    expect(layout.entries.get("month")!.start).toEqual(new Date(2026, 10, 20, 9, 14));
  });

  it("AT-L2 removing a dependency leaves no stale positions", () => {
    const ex = referenceExample();
    const layout = computeLayout({ ...ex, ...removeDependency(ex, "d1") });
    const u = units(layout);
    expect(u.stock).toEqual([0, 3]);
    expect(u.setup).toEqual([0, 3]);
    expect(u.sales).toEqual([3.5, 10]);
  });

  it("AT-L3 removing Login gives the AT-L2 layout", () => {
    const ex = referenceExample();
    const a = units(computeLayout({ ...ex, ...removeDependency(ex, "d1") }));
    const b = units(computeLayout({ ...ex, ...removeItems(ex, ["login"]) }));
    delete a.login;
    expect(b).toEqual(a);
  });

  it("AT-L4 breaks a cycle by ignoring the later dependency", () => {
    const items: FlowItem[] = [
      { id: "A", kind: "leaf", label: "A" },
      { id: "B", kind: "leaf", label: "B" },
    ];
    const dependencies: FlowDependency[] = [
      { id: "ab", from: "A", to: "B" },
      { id: "ba", from: "B", to: "A" },
    ];
    const layout = computeLayout({ items, dependencies, origin: new Date(0) });
    expect(layout.errors).toEqual([{ code: "cycle", dependencyId: "ba" }]);
    expect(units(layout)).toEqual({ A: [0, 3], B: [3.5, 6.5] });
  });

  it("DATA-9 rejects dependencies between a group and its own child", () => {
    const items: FlowItem[] = [
      { id: "g", kind: "group", label: "G" },
      { id: "c", kind: "leaf", parentId: "g", label: "C" },
    ];
    const layout = computeLayout({
      items,
      dependencies: [
        { id: "x", from: "g", to: "c" },
        { id: "y", from: "c", to: "g" },
      ],
      origin: new Date(0),
    });
    expect(layout.errors).toEqual([
      { code: "cycle", dependencyId: "x" },
      { code: "cycle", dependencyId: "y" },
    ]);
    expect(units(layout)).toEqual({ g: [0, 3], c: [0, 3] });
  });

  it("DATA-9 breaks cycles through group constraints and always terminates", () => {
    const items: FlowItem[] = [
      { id: "A", kind: "group", label: "A" },
      { id: "a1", kind: "leaf", parentId: "A", label: "a1" },
      { id: "B", kind: "group", label: "B" },
      { id: "b1", kind: "leaf", parentId: "B", label: "b1" },
    ];
    const layout = computeLayout({
      items,
      dependencies: [
        { id: "a1-B", from: "a1", to: "B" },
        { id: "B-A", from: "B", to: "A" },
      ],
      origin: new Date(0),
    });
    expect(layout.errors).toEqual([{ code: "cycle", dependencyId: "B-A" }]);
    expect(units(layout).b1).toEqual([3.5, 6.5]);
  });

  it("DATA-9 handles a long cycle whose ignored edge is deep in the path", () => {
    const n = 50;
    const items: FlowItem[] = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, kind: "leaf", label: `${i}` }));
    const dependencies: FlowDependency[] = Array.from({ length: n }, (_, i) => ({
      id: `e${i}`,
      from: `n${i}`,
      to: `n${(i + 1) % n}`,
    }));
    const layout = computeLayout({ items, dependencies, origin: new Date(0) });
    expect(layout.errors).toEqual([{ code: "cycle", dependencyId: `e${n - 1}` }]);
    expect(layout.entries.get(`n${n - 1}`)!.startUnits).toBe((n - 1) * 3.5);
  });

  it("AT-L5 reports and ignores unknown endpoints, self dependencies and unsupported types", () => {
    const ex = referenceExample();
    const dependencies: FlowDependency[] = [
      ...ex.dependencies,
      { id: "u1", from: "nope", to: "login" },
      { id: "u2", from: "login", to: "login" },
      { id: "u3", from: "mrp", to: "login", type: "start-to-start" as "finish-to-start" },
    ];
    const layout = computeLayout({ ...ex, dependencies });
    expect(layout.errors).toEqual([
      { code: "unknown-endpoint", dependencyId: "u1" },
      { code: "self-dependency", dependencyId: "u2" },
      { code: "unsupported-type", dependencyId: "u3" },
    ]);
    expect(units(layout)).toEqual(units(computeLayout(ex)));
  });

  it("AT-L6 counts duplicate dependencies once, first wins", () => {
    const ex = referenceExample();
    const dependencies: FlowDependency[] = [
      ...ex.dependencies,
      { id: "dup", from: "login", to: "stock", gap: 5 },
      { id: "d1", from: "mrp", to: "sales" },
    ];
    const layout = computeLayout({ ...ex, dependencies });
    expect(layout.errors).toEqual([
      { code: "duplicate-dependency", dependencyId: "dup" },
      { code: "duplicate-dependency-id", dependencyId: "d1" },
    ]);
    expect(units(layout)).toEqual(units(computeLayout(ex)));
  });

  it("AT-L7 places an empty group at its start with the default span", () => {
    const ex = referenceExample();
    const items: FlowItem[] = [...ex.items, { id: "empty", kind: "group", label: "Empty" }];
    const dependencies = [...ex.dependencies, { id: "e", from: "sales", to: "empty" }];
    const u = units(computeLayout({ ...ex, items, dependencies }));
    expect(u.empty).toEqual([14, 17]);
  });

  it("AT-L8 shifts dates with the origin, units unchanged", () => {
    const ex = referenceExample();
    const a = computeLayout(ex);
    const b = computeLayout({ ...ex, origin: new Date(ex.origin.getTime() + 30 * 60_000) });
    expect(units(b)).toEqual(units(a));
    for (const [id, e] of b.entries) {
      expect(e.start.getTime() - a.entries.get(id)!.start.getTime()).toBe(30 * 60_000);
      expect(e.end.getTime() - a.entries.get(id)!.end.getTime()).toBe(30 * 60_000);
    }
  });

  it("AT-L9 lays out 5,000 items and 5,000 dependencies in under 20 ms", () => {
    const data = large5000();
    expect(data.items.length).toBe(5000);
    expect(data.dependencies.length).toBe(5000);
    for (let i = 0; i < 5; i++) computeLayout(data); // warm up
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      computeLayout(data);
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    const median = times[Math.floor(times.length / 2)]!;
    // CI machines are slower than the reference machine; scripts/bench-layout.mjs checks the strict number.
    expect(median).toBeLessThan(process.env.CI ? 60 : 20);
  });

  it("LAY-9 and LAY-8: layout does not depend on anything but the data", () => {
    const ex = referenceExample();
    const fresh = units(computeLayout(referenceExample()));
    expect(units(computeLayout({ ...ex, items: [...ex.items], dependencies: [...ex.dependencies] }))).toEqual(fresh);
  });

  it("DATA-1 reports invalid items and shows them at top level", () => {
    const items: FlowItem[] = [
      { id: "g", kind: "group", label: "G" },
      { id: "g", kind: "leaf", label: "dup" },
      { id: "x", kind: "leaf", parentId: "missing", label: "x" },
      { id: "leaf", kind: "leaf", label: "leaf" },
      { id: "y", kind: "leaf", parentId: "leaf", label: "y" },
      { id: "h", kind: "group", parentId: "g", label: "h" },
      { id: "c", kind: "leaf", parentId: "g", label: "c" },
    ];
    const layout = computeLayout({ items, dependencies: [], origin: new Date(0) });
    expect(layout.errors).toEqual([
      { code: "duplicate-id", itemId: "g" },
      { code: "unknown-parent", itemId: "x" },
      { code: "invalid-parent", itemId: "y" },
      { code: "nested-group", itemId: "h" },
    ]);
    expect([...layout.entries.keys()]).toEqual(["g", "c", "x", "leaf", "y", "h"]);
  });

  it("DATA-15 falls back on invalid numbers and clamps negative gaps", () => {
    const items: FlowItem[] = [
      { id: "a", kind: "leaf", label: "a", span: 4 },
      { id: "b", kind: "leaf", label: "b", span: Number.NaN },
      { id: "c", kind: "leaf", label: "c", span: -1 },
    ];
    const layout = computeLayout({
      items,
      dependencies: [
        { id: "ab", from: "a", to: "b", gap: -10 },
        { id: "bc", from: "b", to: "c", gap: Number.POSITIVE_INFINITY },
      ],
      origin: new Date(Number.NaN),
      defaultSpan: Number.NaN,
    });
    expect(layout.errors).toEqual([
      { code: "invalid-origin", detail: "Invalid Date" },
      { code: "invalid-option", detail: "defaultSpan" },
      { code: "invalid-number", itemId: "b", field: "span" },
      { code: "invalid-number", itemId: "c", field: "span" },
      { code: "invalid-number", dependencyId: "bc", field: "gap" },
    ]);
    expect(units(layout)).toEqual({ a: [0, 4], b: [0, 3], c: [3.5, 6.5] });
  });

  it("D-14 rejects non-string ids and numbers too large to sum safely", () => {
    const items = [
      { id: 1n, kind: "leaf", label: "big" },
      { id: "a", kind: "leaf", label: "a", span: 1e308 },
      { id: "b", kind: "leaf", label: "b" },
    ] as unknown as FlowItem[];
    const dependencies = [
      { id: "x", from: "a", to: "b", gap: 1e308 },
      { id: 2n, from: "a", to: "b" },
    ] as unknown as FlowDependency[];
    const layout = computeLayout({ items, dependencies, origin: new Date(0) });
    expect(layout.errors).toEqual([
      { code: "invalid-id", itemId: "1" },
      { code: "invalid-number", itemId: "a", field: "span" },
      { code: "invalid-number", dependencyId: "x", field: "gap" },
      { code: "invalid-id", dependencyId: "2" },
    ]);
    expect(units(layout)).toEqual({ a: [0, 3], b: [3.5, 6.5] });
  });

  it("LAY-11 reports a fixed start as unsupported", () => {
    const items = [{ id: "a", kind: "leaf", label: "a", start: new Date() } as FlowItem];
    expect(validate(items, [])).toEqual([{ code: "unsupported-field", itemId: "a", field: "start" }]);
  });

  it("supports hour base units", () => {
    const ex = referenceExample();
    const layout = computeLayout({ ...ex, baseUnit: "hour" });
    expect(layout.entries.get("stock")!.start).toEqual(new Date(2026, 10, 20, 12, 30));
  });

  it("AT-X2 returns the longest path", () => {
    expect(computeLayout(referenceExample()).longestPath).toEqual([
      "login",
      "stock",
      "order",
      "invoice",
      "export",
      "close",
      "mail",
    ]);
  });

  it("X-2 resolves ties to the first item in display order", () => {
    const items: FlowItem[] = [
      { id: "a", kind: "leaf", label: "a" },
      { id: "b", kind: "leaf", label: "b" },
      { id: "c", kind: "leaf", label: "c" },
    ];
    const dependencies: FlowDependency[] = [
      { id: "bc", from: "b", to: "c" },
      { id: "ac", from: "a", to: "c" },
    ];
    expect(computeLayout({ items, dependencies, origin: new Date(0) }).longestPath).toEqual(["a", "c"]);
  });
});

describe("graph helpers", () => {
  const ex = referenceExample();

  it("wouldCreateCycle on explicit dependencies", () => {
    expect(wouldCreateCycle(ex.dependencies, "mail", "export")).toBe(true);
    expect(wouldCreateCycle(ex.dependencies, "export", "mail")).toBe(false);
    expect(wouldCreateCycle(ex.dependencies, "login", "login")).toBe(true);
  });

  it("wouldCreateCycle on the combined graph with items", () => {
    expect(wouldCreateCycle(ex.dependencies, "login", "setup", ex.items)).toBe(true);
    expect(wouldCreateCycle(ex.dependencies, "setup", "login", ex.items)).toBe(true);
    expect(wouldCreateCycle(ex.dependencies, "export", "setup", ex.items)).toBe(true);
    expect(wouldCreateCycle(ex.dependencies, "export", "setup")).toBe(false);
    expect(wouldCreateCycle(ex.dependencies, "mrp", "sales", ex.items)).toBe(false);
  });

  it("getPredecessors and getSuccessors", () => {
    expect(getPredecessors(ex.dependencies, "month")).toEqual(["sales", "mrp"]);
    expect(getSuccessors(ex.dependencies, "login")).toEqual(["stock"]);
    expect(getSuccessors(ex.dependencies, "mail")).toEqual([]);
  });
});
