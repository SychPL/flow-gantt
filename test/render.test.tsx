import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { referenceExample } from "../fixtures/data";
import { FlowGantt } from "../src";
import { barByLabel, boxOf, columns, px, q, qa, renderChart, rowByLabel } from "./helpers";

const ORDER = [
  "Setup",
  "Login",
  "Check stock",
  "Sales flow",
  "Create sales order",
  "Post invoice",
  "Run MRP",
  "Month end",
  "Export report",
  "Close period",
  "Send summary mail",
];

type Pt = { x: number; y: number };
const points = (d: string): Pt[] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

/** True when the axis-aligned segment a-b passes through the inside of the box. */
function crosses(a: Pt, b: Pt, box: { left: number; top: number; width: number; height: number }) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > box.left && minX < box.left + box.width && maxY > box.top && minY < box.top + box.height;
}

describe("rendering", () => {
  it("AT-R1 shows rows in display order (and AT-P5 rows are queryable by role in jsdom)", () => {
    renderChart();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(ORDER);
    expect(screen.getByRole("treegrid", { name: "Flow chart" })).toBeTruthy();
  });

  it("AT-R2 positions bars at 100 px per minute", () => {
    const { container } = renderChart();
    const login = boxOf(barByLabel(container, "Login"));
    expect(login.left).toBe(100);
    expect(login.width).toBe(300);
    const stock = boxOf(barByLabel(container, "Check stock"));
    expect(stock.left - (login.left + login.width)).toBe(50);
    expect(boxOf(barByLabel(container, "Setup")).width).toBe(650);
  });

  it("AT-R3 rows are 36 px, bars 31 px and centred", () => {
    const { container } = renderChart();
    const row = rowByLabel(container, "Check stock");
    expect(px(row.style.height)).toBe(36);
    const bar = boxOf(barByLabel(container, "Check stock"));
    expect(bar.height).toBe(31);
    const rowTop = px(row.style.top);
    const above = bar.top - rowTop;
    const below = rowTop + 36 - (bar.top + bar.height);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1);
  });

  it("AT-R4 the timeline is 27 columns wide", () => {
    const { container } = renderChart();
    expect(px(q(container, ".fg-timeline").style.width)).toBe(2700);
  });

  it("AT-R5 striping is per parent", () => {
    const { container } = renderChart();
    const alt = (l: string) => rowByLabel(container, l).hasAttribute("data-alt");
    expect(alt("Login")).toBe(true);
    expect(alt("Check stock")).toBe(false);
    expect(alt("Run MRP")).toBe(true);
    expect(alt("Export report")).toBe(true);
    expect(alt("Close period")).toBe(false);
    expect(alt("Send summary mail")).toBe(true);
  });

  it("AT-R6 group rows and last-child dividers", () => {
    const { container } = renderChart();
    for (const g of ["Setup", "Sales flow", "Month end"]) expect(rowByLabel(container, g).dataset.kind).toBe("group");
    const last = qa(container, '[role="row"][data-last]').map((r) => r.getAttribute("aria-label"));
    expect(last).toEqual(["Check stock", "Post invoice", "Send summary mail"]);
  });

  it("AT-R7 bar variants with the example host rule", () => {
    const { container } = renderChart({ initialSize: { width: 4000, height: 800 } });
    const v = (l: string) => barByLabel(container, l).dataset.variant;
    expect([v("Login"), v("Create sales order")]).toEqual(["default", "default"]);
    expect([v("Check stock"), v("Run MRP")]).toEqual(["delayed", "delayed"]);
    expect([v("Post invoice"), v("Close period"), v("Send summary mail")]).toEqual([
      "dependent",
      "dependent",
      "dependent",
    ]);
    expect([v("Setup"), v("Sales flow"), v("Month end")]).toEqual(["group", "group", "group"]);
  });

  it("AT-R8 group frames follow expansion and survive new arrays", () => {
    const ex = referenceExample();
    const { container, rerender } = render(
      <FlowGantt
        items={ex.items}
        dependencies={ex.dependencies}
        origin={ex.origin}
        columns={columns}
        animateLayout={false}
      />,
    );
    const frames = () => qa(container, ".fg-frame");
    expect(frames()).toHaveLength(6);
    const head = boxOf(frames()[0]!);
    const body = boxOf(frames()[1]!);
    const setup = boxOf(barByLabel(container, "Setup"));
    expect(head.left).toBe(setup.left - 6);
    expect(head.width).toBe(setup.width + 12);
    expect(head.height).toBe(setup.height + 4);
    const login = boxOf(barByLabel(container, "Login"));
    const stock = boxOf(barByLabel(container, "Check stock"));
    expect(body.left).toBe(login.left - 6);
    expect(body.left + body.width).toBe(stock.left + stock.width + 6);
    expect(body.top).toBe(px(rowByLabel(container, "Login").style.top));
    expect(body.top + body.height).toBe(stock.top + stock.height + 6);

    rerender(
      <FlowGantt
        items={ex.items}
        dependencies={ex.dependencies}
        origin={ex.origin}
        columns={columns}
        collapsedIds={["setup"]}
        animateLayout={false}
      />,
    );
    expect(frames()).toHaveLength(4);
    rerender(
      <FlowGantt
        items={ex.items.map((i) => ({ ...i }))}
        dependencies={[...ex.dependencies]}
        origin={ex.origin}
        columns={columns}
        collapsedIds={[]}
        animateLayout={false}
      />,
    );
    expect(frames()).toHaveLength(6);
  });

  it("AT-R9 draws seven connectors with the normal and backward routes", () => {
    const { container } = renderChart({ initialSize: { width: 4000, height: 800 } });
    const links = qa(container, ".fg-link");
    expect(links).toHaveLength(7);
    for (const g of links) {
      const pts = points(g.querySelector(".fg-link-line")!.getAttribute("d")!);
      expect(pts).toHaveLength(4);
      expect(pts[1]!.y).toBe(pts[0]!.y); // right stub
      expect(pts[1]!.x).toBeGreaterThan(pts[0]!.x);
      expect(pts[2]!.x).toBe(pts[1]!.x); // vertical
      expect(pts[3]!.y).toBe(pts[2]!.y); // horizontal into the target
      const dot = g.querySelector("circle")!;
      expect(Number(dot.getAttribute("r")) * 2).toBe(8);
      expect(Number(dot.getAttribute("cx")) + 4).toBeGreaterThan(pts[3]!.x);
    }
    // Login -> Check stock ends at Check stock's left edge.
    const stock = boxOf(barByLabel(container, "Check stock"));
    const d1 = q(container, '.fg-link[data-fg-dep="0"] circle');
    expect(Number(d1.getAttribute("cx")) + 4).toBe(stock.left);

    // Backward route with a negative gap.
    const ex = referenceExample();
    const dependencies = ex.dependencies.map((d) => (d.id === "d6" ? { ...d, gap: -2 } : d));
    const view = render(
      <FlowGantt
        items={ex.items}
        dependencies={dependencies}
        origin={ex.origin}
        columns={columns}
        initialSize={{ width: 4000, height: 800 }}
        animateLayout={false}
      />,
    );
    const g = qa(view.container, ".fg-link").find((l) => {
      const pts = points(l.querySelector(".fg-link-line")!.getAttribute("d")!);
      return pts.length === 6;
    });
    expect(g).toBeTruthy();
    const pts = points(g!.querySelector(".fg-link-line")!.getAttribute("d")!);
    const src = boxOf(barByLabel(view.container, "Export report"));
    const tgt = boxOf(barByLabel(view.container, "Close period"));
    for (let k = 1; k < pts.length; k++) {
      expect(crosses(pts[k - 1]!, pts[k]!, src)).toBe(false);
      expect(crosses(pts[k - 1]!, pts[k]!, tgt)).toBe(false);
    }
  });

  it("AT-R10 collapsing Month end hides children and their connectors", () => {
    const { container } = renderChart({ collapsedIds: ["month"], initialSize: { width: 4000, height: 800 } });
    const labels = qa(container, '[role="row"][aria-label]').map((r) => r.getAttribute("aria-label"));
    expect(labels).not.toContain("Export report");
    expect(qa(container, ".fg-link")).toHaveLength(5);
    expect(boxOf(barByLabel(container, "Month end")).width).toBe(1000);
    expect(rowByLabel(container, "Month end").getAttribute("aria-expanded")).toBe("false");
  });

  it("AT-R11 renders markup in labels as text", () => {
    const ex = referenceExample();
    const evil = "<img src=x onerror=alert(1)>";
    const items = ex.items.map((i) => (i.id === "login" ? { ...i, label: evil } : i));
    const { container } = render(
      <FlowGantt items={items} dependencies={ex.dependencies} origin={ex.origin} columns={columns} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(rowByLabel(container, evil).textContent).toContain(evil);
    expect(barByLabel(container, evil).textContent).toContain(evil);
  });

  it("AT-R12 error status styles rows and keeps the selection ring", () => {
    const { container } = renderChart({
      getItemStatus: (i) => (i.id === "setup" || i.id === "stock" ? "error" : undefined),
      selectedIds: ["stock"],
    });
    expect(rowByLabel(container, "Setup").dataset.status).toBe("error");
    expect(rowByLabel(container, "Check stock").dataset.status).toBe("error");
    const r = rowByLabel(container, "Check stock").dataset.fgRow;
    const trows = qa(container, ".fg-trow");
    expect(trows[Number(r)]!.dataset.status).toBe("error");
    const bar = barByLabel(container, "Check stock");
    expect(bar.dataset.selected).toBe("true");
    expect(bar.dataset.status).toBe("error");
  });

  it("DATA-1 and SEC-2: invalid data never throws and is reported", () => {
    const onDataError = vi.fn();
    const items = [
      { id: "a", kind: "leaf", label: "A", parentId: "zzz" },
      { id: "a", kind: "leaf", label: "dup" },
      { id: "b", kind: "weird", label: 42 },
    ] as never;
    render(
      <FlowGantt
        items={items}
        dependencies={[{ id: "x", from: "a", to: "nope" }]}
        origin={new Date(Number.NaN)}
        columns={columns}
        onDataError={onDataError}
      />,
    );
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(onDataError).toHaveBeenCalledTimes(1);
    const codes = onDataError.mock.calls[0]![0].map((e: { code: string }) => e.code);
    expect(codes).toEqual(["invalid-origin", "duplicate-id", "unknown-parent", "unknown-endpoint"]);
  });

  it("EVT-2 diagnostics fire only when the result changes", () => {
    const ex = referenceExample();
    const onLayoutChange = vi.fn();
    const props = { origin: ex.origin, columns, onLayoutChange };
    const { rerender } = render(<FlowGantt items={ex.items} dependencies={ex.dependencies} {...props} />);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    rerender(<FlowGantt items={[...ex.items]} dependencies={[...ex.dependencies]} {...props} />);
    expect(onLayoutChange).toHaveBeenCalledTimes(1);
    rerender(<FlowGantt items={ex.items} dependencies={ex.dependencies.slice(1)} {...props} />);
    expect(onLayoutChange).toHaveBeenCalledTimes(2);
  });

  it("DATA-15 clamps size options and reports them", () => {
    const ex = referenceExample();
    const onDataError = vi.fn();
    const { container } = render(
      <FlowGantt
        items={ex.items}
        dependencies={ex.dependencies}
        origin={ex.origin}
        columns={columns}
        rowHeight={5}
        gridWidth={99999}
        onDataError={onDataError}
      />,
    );
    expect(px(rowByLabel(container, "Setup").style.height)).toBe(16);
    expect(onDataError.mock.calls[0]![0]).toEqual([
      { code: "invalid-option", detail: "rowHeight" },
      { code: "invalid-option", detail: "gridWidth" },
    ]);
  });

  it("ZOOM-5 shows scale labels unless hidden", () => {
    const { container, rerender } = render(
      <FlowGantt {...referenceExample()} columns={columns} showTimeScale={true} />,
    );
    expect(qa(container, ".fg-scale-cell")[1]!.textContent).toBe("09:00");
    rerender(<FlowGantt {...referenceExample()} columns={columns} showTimeScale={false} />);
    expect(qa(container, ".fg-scale-cell")).toHaveLength(0);
  });

  it("LAYER-1 host layers get geometry", () => {
    const seen: string[] = [];
    const { container } = renderChart({
      layers: [
        {
          id: "marker",
          zIndex: "above-bars",
          render: (ctx) => {
            const box = ctx.getItemBox("stock");
            seen.push(`${box?.bar.left}:${ctx.getChildrenBoxes("month").length}:${ctx.visibleItems.length}`);
            return <div className="host-marker" style={{ left: box?.bar.left }} />;
          },
        },
      ],
    });
    expect(container.querySelector(".host-marker")).toBeTruthy();
    expect(seen.at(-1)).toBe("450:3:11");
  });

  it("virtualises rows (PERF-1)", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: `i${i}`, kind: "leaf" as const, label: `Item ${i}` }));
    const { container } = render(<FlowGantt items={items} dependencies={[]} origin={new Date(0)} columns={columns} />);
    const rows = qa(container, '[role="row"][aria-label]');
    expect(rows.length).toBeLessThan(40);
    const scroller = q(container, ".fg-scroller");
    act(() => {
      scroller.scrollTop = 36 * 1000;
      fireEvent.scroll(scroller);
    });
    const labels = qa(container, '[role="row"][aria-label]').map((r) => r.getAttribute("aria-label"));
    expect(labels).toContain("Item 1005");
    expect(labels).not.toContain("Item 500");
  });
});
