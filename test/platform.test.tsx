import { act, fireEvent, render } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { referenceExample } from "../fixtures/data";
import { FlowGantt } from "../src";
import { columns, px, q, qa } from "./helpers";

describe("platform", () => {
  it("AT-P4 hydrates server HTML without mismatches", async () => {
    const ex = referenceExample();
    const ui = <FlowGantt {...ex} columns={columns} aria-label="Flow chart" />;
    const html = renderToString(ui);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, ui, { onRecoverableError: (e) => recoverable.push(e) });
    });
    expect(recoverable).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(qa(container, '[role="row"][aria-label]')).toHaveLength(11);
    errors.mockRestore();
    act(() => root!.unmount());
    container.remove();
  });

  it("AT-P6 two charts keep separate selection, scroll and zoom", () => {
    const ex = referenceExample();
    const { container } = render(
      <>
        <div className="a">
          <FlowGantt {...ex} columns={columns} aria-label="A" />
        </div>
        <div className="b">
          <FlowGantt {...ex} columns={columns} aria-label="B" />
        </div>
      </>,
    );
    const a = q(container, ".a");
    const b = q(container, ".b");
    const bar = (root: HTMLElement) => q(root, '.fg-bar[data-fg-bar="6"]');
    fireEvent.pointerDown(bar(a), { pointerId: 1, button: 0 });
    fireEvent.pointerUp(bar(a), { pointerId: 1, button: 0 });
    expect(bar(a).dataset.selected).toBe("true");
    expect(bar(b).dataset.selected).toBe("false");

    fireEvent.wheel(q(a, ".fg-scroller"), { ctrlKey: true, deltaY: 100, clientX: 600, clientY: 100 });
    expect(px(bar(a).style.width)).toBe(60);
    expect(px(bar(b).style.width)).toBe(300);

    act(() => {
      const s = q(a, ".fg-scroller");
      s.scrollLeft = 40;
      fireEvent.scroll(s);
    });
    expect(q(b, ".fg-scroller").scrollLeft).toBe(0);

    const ids = qa(container, "[id]").map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
