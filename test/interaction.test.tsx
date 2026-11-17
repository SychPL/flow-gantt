import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { referenceExample } from "../fixtures/data";
import { FlowGantt } from "../src";
import { barByLabel, columns, q, renderChart } from "./helpers";

afterEach(() => vi.useRealTimers());

describe("interaction (jsdom)", () => {
  it("INT-23 tap selects and long press opens the context menu once", () => {
    vi.useFakeTimers();
    const onSelectionChange = vi.fn();
    const onContextMenu = vi.fn(() => true);
    const { container } = renderChart({ onSelectionChange, onContextMenu });
    const b = barByLabel(container, "Run MRP");
    fireEvent.pointerDown(b, { pointerType: "touch", pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(b, { pointerType: "touch", pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["mrp"], { source: "pointer" });

    fireEvent.pointerDown(b, { pointerType: "touch", pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const ev = (onContextMenu.mock.calls[0] as unknown[])[0] as { target: { type: string }; area: string };
    expect([ev.target.type, ev.area]).toEqual(["item", "timeline"]);
    // The browser's own contextmenu for the same long press is swallowed (INT-10).
    const native = fireEvent.contextMenu(b);
    expect(native).toBe(false);
    fireEvent.pointerUp(b, { pointerType: "touch", pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
  });

  it("INT-10 one right-click gives one onContextMenu call; INT-9 default kept when not handled", () => {
    const onContextMenu = vi.fn(() => undefined);
    const { container } = renderChart({ onContextMenu });
    const notCancelled = fireEvent.contextMenu(barByLabel(container, "Run MRP"));
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(notCancelled).toBe(true);
  });

  it("EVT-2 prop changes never call user-action callbacks", () => {
    const ex = referenceExample();
    const cb = { onSelectionChange: vi.fn(), onCollapsedChange: vi.fn(), onZoomLevelChange: vi.fn() };
    const base = { ...ex, columns, ...cb };
    const { rerender } = render(<FlowGantt {...base} />);
    rerender(<FlowGantt {...base} selectedIds={["login"]} collapsedIds={["month"]} zoomLevel="5min" />);
    rerender(<FlowGantt {...base} selectedIds={[]} collapsedIds={[]} zoomLevel="1h" readOnly />);
    expect(cb.onSelectionChange).not.toHaveBeenCalled();
    expect(cb.onCollapsedChange).not.toHaveBeenCalled();
    expect(cb.onZoomLevelChange).not.toHaveBeenCalled();
  });

  it("INT-14 Escape cancels a dependency drag", () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderChart({
      onDependencyCreate,
      selectedIds: ["export"],
      initialSize: { width: 4000, height: 800 },
    });
    const handle = q(barByLabel(container, "Export report"), '[data-fg-handle="right"]');
    fireEvent.pointerDown(handle, { pointerId: 5, button: 0, clientX: 0, clientY: 0 });
    expect(q(container, ".fg-root").hasAttribute("data-linking")).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(q(container, ".fg-root").hasAttribute("data-linking")).toBe(false);
    fireEvent.pointerUp(handle, { pointerId: 5, button: 0 });
    expect(onDependencyCreate).not.toHaveBeenCalled();
  });

  it("API-1 scrollToItem on a hidden item is a no-op", () => {
    const { handle } = renderChart({ collapsedIds: ["month"] });
    expect(() => handle.current!.scrollToItem("mail")).not.toThrow();
    expect(handle.current!.getItemBox("mail")).toBeNull();
    expect(handle.current!.getItemBox("month")!.bar.width).toBe(1000);
  });
});

describe("remaining requirements", () => {
  it("REN-23 arrow end marker; REN-37 canConnectFrom hides handles", () => {
    const { container } = renderChart({
      linkEndMarker: "arrow",
      selectedIds: ["login", "mrp"],
      canConnectFrom: (i) => i.id !== "mrp",
    });
    expect(container.querySelector(".fg-link circle")).toBeNull();
    expect(container.querySelector("path.fg-link-end")).toBeTruthy();
    expect(barByLabel(container, "Login").querySelectorAll(".fg-handle")).toHaveLength(2);
    expect(barByLabel(container, "Run MRP").querySelectorAll(".fg-handle")).toHaveLength(0);
  });

  it("INT-6 a click on empty grid space clears the selection", () => {
    const onSelectionChange = vi.fn();
    const { container } = renderChart({ onSelectionChange, selectedIds: ["login"] });
    const body = q(container, ".fg-grid-body");
    fireEvent.pointerDown(body, { pointerId: 3, button: 0, clientX: 50, clientY: 550 });
    fireEvent.pointerUp(body, { pointerId: 3, button: 0, clientX: 50, clientY: 550 });
    expect(onSelectionChange).toHaveBeenLastCalledWith([], { source: "pointer" });
  });

  it("REN-3 resizable grid splitter", () => {
    const { container } = renderChart({ resizableGrid: true });
    const splitter = q(container, ".fg-splitter");
    fireEvent.pointerDown(splitter, { pointerId: 4, button: 0, clientX: 360 });
    fireEvent.pointerMove(splitter, { pointerId: 4, clientX: 460 });
    fireEvent.pointerUp(splitter, { pointerId: 4, clientX: 460 });
    expect(q(container, ".fg-grid").style.width).toBe("460px");
  });

  it("DATA-12 uncontrolled expansion starts expanded and toggles", () => {
    const ex = referenceExample();
    const onCollapsedChange = vi.fn();
    const { container } = render(<FlowGantt {...ex} columns={columns} onCollapsedChange={onCollapsedChange} />);
    const toggle = q(container, '[aria-label="Month end"] .fg-toggle');
    fireEvent.pointerDown(toggle, { pointerId: 6, button: 0 });
    fireEvent.pointerUp(toggle, { pointerId: 6, button: 0 });
    expect(onCollapsedChange).toHaveBeenCalledWith(["month"]);
    expect(container.querySelector('[aria-label="Export report"]')).toBeNull();
  });
});
