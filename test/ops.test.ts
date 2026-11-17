import { describe, expect, it } from "vitest";
import { referenceExample } from "../fixtures/data";
import type { FlowItem } from "../src/layout";
import { addItems, type FlowState, moveToGroup, removeDependency, removeItems, reorder, ungroup } from "../src/ops";

function deepFreeze<T>(v: T): T {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

const state = (): FlowState<unknown> => {
  const ex = referenceExample();
  return deepFreeze({ items: ex.items, dependencies: ex.dependencies });
};
const ids = (s: FlowState<unknown>) => s.items.map((i) => i.id);
const parents = (s: FlowState<unknown>) => Object.fromEntries(s.items.map((i) => [i.id, i.parentId ?? null]));
const depIds = (s: FlowState<unknown>) => s.dependencies.map((d) => d.id);

describe("ops", () => {
  it("AT-O1 ungroup on a group with two linked leaves", () => {
    const s = state();
    const { state: r, movedIds } = ungroup(s, "setup");
    expect(movedIds).toEqual(["login", "stock"]);
    expect(ids(r)).toEqual(["login", "stock", "sales", "order", "invoice", "mrp", "month", "export", "close", "mail"]);
    expect(parents(r).login).toBe(null);
    expect(parents(r).stock).toBe(null);
    expect(depIds(r)).toEqual(["d3", "d4", "d5", "d6", "d7"]);
    expect(r.items.find((i) => i.id === "stock")!.data).toBe(s.items.find((i) => i.id === "stock")!.data);
  });

  it("AT-O2 ungroup on one leaf keeps the group with the other leaf", () => {
    const { state: r, movedIds } = ungroup(state(), "stock");
    expect(movedIds).toEqual(["stock"]);
    expect(parents(r).stock).toBe(null);
    expect(parents(r).login).toBe("setup");
    expect(ids(r)).toContain("setup");
    expect(depIds(r)).not.toContain("d1");
    expect(depIds(r)).toContain("d2");
  });

  it("AT-O3 ungroup on the last leaf removes the group and its dependencies", () => {
    const first = ungroup(state(), "stock").state;
    const { state: r } = ungroup(first, "login");
    expect(ids(r)).not.toContain("setup");
    expect(parents(r).login).toBe(null);
    expect(depIds(r)).not.toContain("d2");
  });

  it("ungroup on a top-level leaf or unknown id is a no-op", () => {
    const s = state();
    expect(ungroup(s, "mrp")).toEqual({ state: s, movedIds: [] });
    expect(ungroup(s, "zzz")).toEqual({ state: s, movedIds: [] });
  });

  it("AT-O4 moveToGroup into an existing group appends and drops dependencies", () => {
    const r = moveToGroup(state(), ["order", "mrp"], { groupId: "month" });
    expect(ids(r).slice(-2)).toEqual(["order", "mrp"]);
    expect(parents(r).order).toBe("month");
    expect(parents(r).mrp).toBe("month");
    expect(depIds(r)).toEqual(["d1", "d2", "d4", "d6", "d7"]);
  });

  it("moveToGroup removes source groups left empty, with their dependencies", () => {
    const r = moveToGroup(state(), ["login", "stock"], { groupId: "month" });
    expect(ids(r)).not.toContain("setup");
    expect(depIds(r)).toEqual(["d3", "d4", "d5", "d6", "d7"]);
  });

  it("AT-O5 moveToGroup with a new group", () => {
    const newGroup: FlowItem = { id: "new", kind: "group", label: "New", data: { x: 1 } };
    const r = moveToGroup(state(), ["mrp", "invoice"], { newGroup });
    expect(ids(r).slice(-3)).toEqual(["new", "invoice", "mrp"]);
    expect(parents(r).invoice).toBe("new");
    expect(parents(r).mrp).toBe("new");
    expect(r.items.find((i) => i.id === "new")!.data).toBe(newGroup.data);
    expect(depIds(r)).toEqual(["d1", "d2", "d4", "d6", "d7"]);
  });

  it("AT-O6 addItems at top level, into a parent, and chained", () => {
    let n = 0;
    const newDependencyId = () => `n${++n}`;
    const leaf = (id: string): FlowItem => ({ id, kind: "leaf", label: id });
    const top = addItems(state(), [leaf("x")], { newDependencyId });
    expect(ids(top).at(-1)).toBe("x");
    expect(parents(top).x).toBe(null);
    expect(top.dependencies).toHaveLength(7);

    const inGroup = addItems(state(), [leaf("y")], { parentId: "sales", newDependencyId });
    expect(parents(inGroup).y).toBe("sales");

    const chained = addItems(state(), [leaf("a"), leaf("b"), leaf("c")], {
      parentId: "month",
      chain: true,
      gap: 0.5,
      newDependencyId,
    });
    expect(chained.dependencies.slice(7)).toEqual([
      { id: "n1", from: "a", to: "b", type: "finish-to-start", gap: 0.5 },
      { id: "n2", from: "b", to: "c", type: "finish-to-start", gap: 0.5 },
    ]);
  });

  it("AT-O7 removeItems on the only child removes the group too", () => {
    const one = removeItems(state(), ["order"]);
    const r = removeItems(one, ["invoice"]);
    expect(ids(r)).not.toContain("sales");
    expect(depIds(r)).toEqual(["d1", "d5", "d6", "d7"]);
  });

  it("removeItems removes children of removed groups and their dependencies", () => {
    const r = removeItems(state(), ["month"]);
    expect(ids(r)).toEqual(["setup", "login", "stock", "sales", "order", "invoice", "mrp"]);
    expect(depIds(r)).toEqual(["d1", "d2", "d3"]);
  });

  it("removeDependency", () => {
    expect(depIds(removeDependency(state(), "d4"))).toEqual(["d1", "d2", "d3", "d5", "d6", "d7"]);
  });

  it("reorder within a parent and to top level", () => {
    const r = reorder(state(), { itemId: "invoice", newParentId: "sales", newIndex: 0 });
    expect(ids(r).slice(3, 6)).toEqual(["sales", "invoice", "order"]);
    const down = reorder(state(), { itemId: "export", newParentId: "month", newIndex: 9 });
    expect(ids(down).slice(-3)).toEqual(["close", "mail", "export"]);
    const top = reorder(state(), { itemId: "mrp", newParentId: null, newIndex: 0 });
    expect(ids(top)[0]).toBe("mrp");
    expect(reorder(state(), { itemId: "setup", newParentId: "sales", newIndex: 0 })).toEqual(state());
  });

  it("AT-O8 no helper mutates its input", () => {
    const s = state();
    const before = JSON.stringify(s);
    let n = 0;
    const newDependencyId = () => `z${++n}`;
    addItems(s, [{ id: "q", kind: "leaf", label: "q" }], { chain: true, newDependencyId });
    removeItems(s, ["setup", "mrp"]);
    moveToGroup(s, ["mrp"], { groupId: "setup" });
    moveToGroup(s, ["login"], { newGroup: { id: "ng", kind: "group", label: "ng" } });
    ungroup(s, "month");
    ungroup(s, "close");
    removeDependency(s, "d1");
    reorder(s, { itemId: "close", newParentId: "month", newIndex: 0 });
    expect(JSON.stringify(s)).toBe(before);
  });
});
