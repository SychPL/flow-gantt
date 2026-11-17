import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { barByLabel, boxOf, px, q, qa, renderChart, rowByLabel } from "./helpers";

const WIDE = { width: 4000, height: 800 };
const ALL = [
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
const undimmedBars = (c: HTMLElement) => ALL.filter((l) => !barByLabel(c, l).hasAttribute("data-dimmed"));
const undimmedLinks = (c: HTMLElement) => qa(c, ".fg-link:not([data-dimmed])").map((g) => Number(g.dataset.fgDep));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("beyond parity", () => {
  it("AT-X1 chain highlight on hover and focus", () => {
    const { container, rerender } = renderChart({ initialSize: WIDE });
    fireEvent.pointerMove(barByLabel(container, "Check stock"), { pointerType: "mouse" });
    const full = ALL.filter((l) => l !== "Run MRP");
    expect(undimmedBars(container)).toEqual(full);
    expect(rowByLabel(container, "Run MRP").hasAttribute("data-dimmed")).toBe(true);
    // d5 (Run MRP -> Month end) is the only dimmed connector.
    expect(undimmedLinks(container)).toEqual([0, 1, 2, 3, 5, 6]);

    // Keyboard focus gives the same highlight.
    fireEvent.pointerLeave(q(container, ".fg-scroller"));
    expect(undimmedBars(container)).toEqual(ALL);
    act(() => rowByLabel(container, "Check stock").focus());
    expect(undimmedBars(container)).toEqual(full);
    act(() => (document.activeElement as HTMLElement).blur());
    rerender(<div />);

    const direct = renderChart({ initialSize: WIDE, chainHighlight: "direct" });
    fireEvent.pointerMove(barByLabel(direct.container, "Check stock"), { pointerType: "mouse" });
    expect(undimmedBars(direct.container)).toEqual(["Login", "Check stock"]);
    direct.unmount();

    const none = renderChart({ initialSize: WIDE, chainHighlight: "none" });
    fireEvent.pointerMove(barByLabel(none.container, "Check stock"), { pointerType: "mouse" });
    expect(undimmedBars(none.container)).toEqual(ALL);
  });

  it("AT-X2 longest path styling and description", () => {
    const { container } = renderChart({ initialSize: WIDE, highlightLongestPath: true });
    const path = ALL.filter((l) => barByLabel(container, l).hasAttribute("data-path"));
    expect(path).toEqual([
      "Login",
      "Check stock",
      "Create sales order",
      "Post invoice",
      "Export report",
      "Close period",
      "Send summary mail",
    ]);
    const links = qa(container, ".fg-link[data-path]").map((g) => Number(g.dataset.fgDep));
    expect(links).toEqual([0, 1, 2, 3, 5, 6]);
    const row = rowByLabel(container, "Close period");
    expect(document.getElementById(row.getAttribute("aria-describedby")!)!.textContent).toContain(
      "On the longest path.",
    );
  });

  it("AT-X3 fitToView and flashItem", () => {
    vi.useFakeTimers();
    const onZoomLevelChange = vi.fn();
    const { container, handle } = renderChart({ onZoomLevelChange });
    act(() => handle.current!.fitToView());
    expect(onZoomLevelChange).toHaveBeenLastCalledWith("10min");
    expect(px(barByLabel(container, "Login").style.width)).toBe(30);
    expect(q(container, ".fg-scroller").scrollLeft).toBe(0);
    act(() => handle.current!.fitToView({ ids: ["invoice"] }));
    expect(onZoomLevelChange).toHaveBeenLastCalledWith("1min");
    expect(q(container, ".fg-scroller").scrollLeft).toBe(1050);

    act(() => handle.current!.flashItem("invoice"));
    expect(barByLabel(container, "Post invoice").hasAttribute("data-flash")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(barByLabel(container, "Post invoice").hasAttribute("data-flash")).toBe(false);

    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q }));
    act(() => handle.current!.flashItem("invoice"));
    expect(barByLabel(container, "Post invoice").hasAttribute("data-flash")).toBe(false);
  });

  it("AT-X4 sticky group header is pinned until the block scrolls out", () => {
    const { container } = renderChart();
    const scroller = q(container, ".fg-scroller");
    const scrollTo = (top: number) =>
      act(() => {
        scroller.scrollTop = top;
        fireEvent.scroll(scroller);
      });
    scrollTo(290);
    let pinned = q(container, ".fg-row-pinned");
    expect(pinned.getAttribute("aria-hidden")).toBe("true");
    expect(pinned.getAttribute("role")).toBeNull();
    expect(pinned.textContent).toContain("Month end");
    expect(px(pinned.style.top)).toBe(290);
    scrollTo(380);
    pinned = q(container, ".fg-row-pinned");
    expect(px(pinned.style.top)).toBe(360);
    scrollTo(100);
    expect(q(container, ".fg-row-pinned").textContent).toContain("Setup");
    scrollTo(0);
    expect(q(container, ".fg-row-pinned")).toBeNull();
  });

  it("AT-X5 statuses style bars and appear in the description", () => {
    const statuses = { login: "warning", stock: "success", order: "running", invoice: "pending", mrp: "skipped" };
    const { container } = renderChart({
      initialSize: WIDE,
      getItemStatus: (i) => statuses[i.id as keyof typeof statuses] as never,
    });
    const texts = { Login: "Warning", "Check stock": "Succeeded", "Create sales order": "Running" };
    for (const [label, text] of Object.entries(texts)) {
      const row = rowByLabel(container, label);
      expect(document.getElementById(row.getAttribute("aria-describedby")!)!.textContent).toContain(text);
    }
    expect(barByLabel(container, "Post invoice").dataset.status).toBe("pending");
    expect(barByLabel(container, "Run MRP").dataset.status).toBe("skipped");
  });

  it("AT-X8 highlightedIds dims everything else; an empty array dims nothing", () => {
    const { container, unmount } = renderChart({ initialSize: WIDE, highlightedIds: ["invoice", "close"] });
    expect(undimmedBars(container)).toEqual(["Post invoice", "Close period"]);
    expect(rowByLabel(container, "Setup").hasAttribute("data-dimmed")).toBe(true);
    expect(rowByLabel(container, "Post invoice").hasAttribute("data-dimmed")).toBe(false);
    expect(undimmedLinks(container)).toEqual([]);
    unmount();
    const none = renderChart({ initialSize: WIDE, highlightedIds: [] });
    expect(undimmedBars(none.container)).toEqual(ALL);
  });

  it("LAYER-3 group frames can be turned off; X-7 preview shows ghost bars", () => {
    const { container } = renderChart({ initialSize: WIDE, groupFrames: false });
    expect(qa(container, ".fg-frame")).toHaveLength(0);
    expect(boxOf(barByLabel(container, "Setup")).width).toBe(650);
  });
});
