// Pure layout and graph helpers (`@sychpl/flow-gantt/layout`). No React, no DOM.

import { buildModel, reach } from "./model.js";
import { layoutFromModel, resolveLayoutOptions } from "./resolve.js";
import type { FlowDataError, FlowDependency, FlowItem, FlowLayout, ItemId, LayoutInput } from "./types.js";

export type * from "./types.js";

/** LAY-10: pure layout of items on the time axis. */
export function computeLayout<TData>(input: LayoutInput<TData>): FlowLayout {
  const opts = resolveLayoutOptions(input);
  const model = buildModel(input.items, input.dependencies, opts);
  return layoutFromModel(model, input.origin, opts.baseUnit, opts.errors);
}

/** Data errors of items and dependencies (no option or origin checks). */
export function validate<TData>(
  items: readonly FlowItem<TData>[],
  dependencies: readonly FlowDependency[],
): FlowDataError[] {
  return buildModel(items, dependencies).errors;
}

/**
 * True when adding `from -> to` would create a cycle. With `items`, the combined layout
 * graph of DATA-9 (group start and end constraints) is used; without, only explicit
 * dependencies are considered.
 */
export function wouldCreateCycle<TData>(
  dependencies: readonly FlowDependency[],
  from: ItemId,
  to: ItemId,
  items?: readonly FlowItem<TData>[],
): boolean {
  if (from === to) return true;
  if (items) {
    const model = buildModel(items, dependencies);
    const f = model.index.get(from);
    const t = model.index.get(to);
    if (f === undefined || t === undefined) return false;
    // The new edge E(f) -> S(t) closes a cycle when S(t) already reaches E(f).
    return reach([2 * t], model.edgeStart, model.edgeTo)[2 * f + 1] === 1;
  }
  const out = new Map<ItemId, ItemId[]>();
  for (const d of dependencies) {
    if (!d || (d.type !== undefined && d.type !== "finish-to-start")) continue;
    let list = out.get(d.from);
    if (!list) {
      list = [];
      out.set(d.from, list);
    }
    list.push(d.to);
  }
  const seen = new Set<ItemId>([to]);
  const stack = [to];
  while (stack.length > 0) {
    const v = stack.pop()!;
    if (v === from) return true;
    for (const w of out.get(v) ?? []) {
      if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
  }
  return false;
}

function neighbours(deps: readonly FlowDependency[], id: ItemId, dir: "from" | "to"): ItemId[] {
  const other = dir === "to" ? "from" : "to";
  const out: ItemId[] = [];
  const seen = new Set<ItemId>();
  for (const d of deps) {
    if (!d || d[dir] !== id || d[other] === id || seen.has(d[other])) continue;
    seen.add(d[other]);
    out.push(d[other]);
  }
  return out;
}

/** Ids of direct predecessors in input order, deduplicated. */
export function getPredecessors(dependencies: readonly FlowDependency[], id: ItemId): ItemId[] {
  return neighbours(dependencies, id, "to");
}

/** Ids of direct successors in input order, deduplicated. */
export function getSuccessors(dependencies: readonly FlowDependency[], id: ItemId): ItemId[] {
  return neighbours(dependencies, id, "from");
}
