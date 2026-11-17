import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { exampleCanConnect } from "../fixtures/data";
import { q, qa, renderChart, rowByLabel } from "./helpers";

const focused = () => document.activeElement?.getAttribute("aria-label");
const key = (k: string, opts: Record<string, unknown> = {}) => {
  const el = document.activeElement as HTMLElement;
  act(() => {
    fireEvent.keyDown(el, { key: k, ...opts });
  });
};
const live = (c: HTMLElement) => q(c, ".fg-live").textContent ?? "";

describe("accessibility and keyboard", () => {
  it("AT-A1 exposes a treegrid with level, set size, position, expansion and selection", () => {
    const { container } = renderChart({ selectedIds: ["stock"] });
    const grid = screen.getByRole("treegrid", { name: "Flow chart" });
    expect(grid.getAttribute("aria-multiselectable")).toBe("true");
    const attrs = (l: string) => {
      const r = rowByLabel(container, l);
      return [
        r.getAttribute("aria-level"),
        r.getAttribute("aria-setsize"),
        r.getAttribute("aria-posinset"),
        r.getAttribute("aria-expanded"),
        r.getAttribute("aria-selected"),
      ];
    };
    expect(attrs("Setup")).toEqual(["1", "4", "1", "true", "false"]);
    expect(attrs("Check stock")).toEqual(["2", "2", "2", null, "true"]);
    expect(attrs("Run MRP")).toEqual(["1", "4", "3", null, "false"]);
    expect(attrs("Send summary mail")).toEqual(["2", "3", "3", null, "false"]);
    expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: "ID Name" })).toBeTruthy();
  });

  it("AT-A2 one tab stop and arrow-key navigation", () => {
    const onCollapsedChange = vi.fn();
    const { container } = renderChart({ onCollapsedChange });
    const tabbable = qa(container, '[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    act(() => tabbable[0]!.focus());
    expect(focused()).toBe("Setup");
    key("ArrowDown");
    expect(focused()).toBe("Login");
    key("End");
    expect(focused()).toBe("Send summary mail");
    key("Home");
    expect(focused()).toBe("Setup");
    key("PageDown");
    expect(focused()).not.toBe("Setup");
    key("Home");
    key("ArrowLeft");
    expect(onCollapsedChange).toHaveBeenLastCalledWith(["setup"]);
    expect(qa(container, '[role="row"][aria-label="Login"]')).toHaveLength(0);
    key("ArrowRight");
    expect(onCollapsedChange).toHaveBeenLastCalledWith([]);
    key("ArrowRight");
    expect(focused()).toBe("Login");
    key("ArrowLeft");
    expect(focused()).toBe("Setup");
    expect(qa(container, '[tabindex="0"]')).toHaveLength(1);
  });

  it("AT-A3 space, ctrl+space and shift+arrow change the selection and announce it", () => {
    const onSelectionChange = vi.fn();
    const { container } = renderChart({ onSelectionChange });
    act(() => rowByLabel(container, "Setup").focus());
    key("ArrowDown");
    key(" ");
    expect(onSelectionChange).toHaveBeenLastCalledWith(["login"], { source: "keyboard" });
    key("ArrowDown");
    key(" ", { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["login", "stock"], { source: "keyboard" });
    key(" ", { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["login"], { source: "keyboard" });
    // Ctrl+Space moved the anchor to Check stock, like Ctrl+click does (INT-3).
    key("ArrowDown", { shiftKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith(["stock", "sales"], { source: "keyboard" });
    expect(live(container)).toBe("2 items selected");
    key("a", { ctrlKey: true });
    expect(onSelectionChange.mock.lastCall![0]).toHaveLength(11);
    expect(live(container)).toBe("11 items selected");
    key("Escape");
    expect(onSelectionChange).toHaveBeenLastCalledWith([], { source: "keyboard" });
  });

  it("AT-A4 rows describe predecessors, successors, status and variant", () => {
    const { container } = renderChart({ getItemStatus: (i) => (i.id === "stock" ? "error" : undefined) });
    const row = rowByLabel(container, "Check stock");
    const desc = document.getElementById(row.getAttribute("aria-describedby")!)!.textContent;
    expect(desc).toContain("Starts after: Login.");
    expect(desc).toContain("Followed by: none.");
    expect(desc).toContain("Has errors");
    expect(desc).toContain("Delayed.");
    const login = rowByLabel(container, "Login");
    expect(document.getElementById(login.getAttribute("aria-describedby")!)!.textContent).toContain(
      "Followed by: Check stock.",
    );
  });

  it("AT-A5 shift+F10 opens the context menu, Delete requests deletion only in edit mode", () => {
    const onContextMenu = vi.fn(() => true);
    const onDeleteRequest = vi.fn();
    const { container, rerender } = renderChart({ onContextMenu, onDeleteRequest, selectedIds: ["mrp", "login"] });
    act(() => rowByLabel(container, "Check stock").focus());
    key("F10", { shiftKey: true });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const ev = (onContextMenu.mock.calls[0] as unknown[])[0] as { target: { type: string; item: { id: string } } };
    expect(ev.target.type).toBe("item");
    expect(ev.target.item.id).toBe("stock");
    // The native contextmenu event that follows the key is not reported again (INT-10).
    act(() => {
      fireEvent.contextMenu(document.activeElement!);
    });
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    key("Delete");
    expect(onDeleteRequest).toHaveBeenCalledWith(["mrp", "login"]);
    rerender(<div />);
    const ro = renderChart({ onDeleteRequest, readOnly: true });
    act(() => rowByLabel(ro.container, "Check stock").focus());
    onDeleteRequest.mockClear();
    key("Delete");
    expect(onDeleteRequest).not.toHaveBeenCalled();
  });

  it("A11Y-9 keyboard dependency creation with announcements", () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderChart({ onDependencyCreate, canConnect: exampleCanConnect });
    act(() => rowByLabel(container, "Export report").focus());
    key("d");
    expect(live(container)).toContain("Linking from Export report");
    key("ArrowDown");
    expect(live(container)).toBe("Connect to Close period, not allowed");
    key("ArrowDown");
    expect(live(container)).toBe("Connect to Send summary mail, allowed");
    key("Enter");
    expect(onDependencyCreate).toHaveBeenCalledWith({ from: "export", to: "mail", type: "finish-to-start" });
    expect(live(container)).toBe("Dependency created from Export report to Send summary mail");
    // Escape cancels; the shortcut can be disabled; read-only blocks it.
    key("d");
    key("Escape");
    key("Enter");
    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
  });

  it("A11Y-9 the D shortcut can be turned off and Alt+arrows reorder", () => {
    const onDependencyCreate = vi.fn();
    const onReorder = vi.fn();
    const { container } = renderChart({
      onDependencyCreate,
      onReorder,
      keyboardShortcuts: { beginDependency: false },
    });
    act(() => rowByLabel(container, "Close period").focus());
    key("d");
    expect(live(container)).toBe("");
    key("ArrowUp", { altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1);
    const change = onReorder.mock.calls[0]![0];
    expect([change.item.id, change.newParentId, change.newIndex]).toEqual(["close", "month", 0]);
    expect(live(container)).toBe("Close period moved to position 1");
  });

  it("A11Y-14 uses the aria-label prop", () => {
    renderChart({ "aria-label": "Scheduler 7" });
    expect(screen.getByRole("treegrid", { name: "Scheduler 7" })).toBeTruthy();
  });

  it("I18N-1 messages are overridable", () => {
    const { container } = renderChart({ messages: { startsAfter: (l) => `Nach: ${l.join("; ")}` } });
    const row = rowByLabel(container, "Check stock");
    expect(document.getElementById(row.getAttribute("aria-describedby")!)!.textContent).toContain("Nach: Login");
  });
});

describe("keyboard robustness (Codex review of milestone 4)", () => {
  it("ignores keys typed into interactive cell content and key repeat of one-shot actions", () => {
    const onDeleteRequest = vi.fn();
    const onItemActivate = vi.fn();
    const { container } = renderChart({
      onDeleteRequest,
      onItemActivate,
      columns: [{ id: "n", header: "Name", tree: true, render: (i) => <input aria-label={`edit ${i.label}`} /> }],
    });
    const input = container.querySelector('input[aria-label="edit Run MRP"]') as HTMLInputElement;
    act(() => input.focus());
    key("Delete");
    expect(onDeleteRequest).not.toHaveBeenCalled();
    act(() => rowByLabel(container, "Run MRP").focus());
    key("Enter");
    key("Enter", { repeat: true });
    expect(onItemActivate).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the group when the focused child is collapsed by the host", () => {
    const { container, rerender } = renderChart();
    act(() => rowByLabel(container, "Check stock").focus());
    expect(focused()).toBe("Check stock");
    act(() => {
      rowByLabel(container, "Setup")
        .querySelector<HTMLElement>(".fg-toggle")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 9 }));
      rowByLabel(container, "Setup")
        .querySelector<HTMLElement>(".fg-toggle")!
        .dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 9 }));
    });
    void rerender;
    expect(qa(container, '[role="row"][aria-label="Check stock"]')).toHaveLength(0);
    expect(focused()).toBe("Setup");
  });
});
