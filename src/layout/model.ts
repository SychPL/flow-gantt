// Internal graph model shared by computeLayout, the graph helpers and the component.
// Every item i has two nodes: S(i) = 2i (start) and E(i) = 2i + 1 (end).
// Edges: S(i)->E(i); for each child c of group g: S(g)->S(c) and E(c)->E(g) (implicit,
// never ignored); for each explicit dependency: E(from)->S(to). See spec DATA-9.

import type { FlowDataError, FlowDependency, FlowItem, ItemId } from "./types.js";

export const DEFAULT_SPAN = 3;
export const DEFAULT_GAP = 0.5;
const EPS = 1e-9;

export interface ModelDep {
  dep: FlowDependency;
  from: number;
  to: number;
  /** Effective gap (default applied, not yet clamped). */
  gap: number;
  /** True when the dependency is ignored for layout because of a cycle (drawn as invalid). */
  ignored: boolean;
}

export interface Model<TData = unknown> {
  /** Valid unique items in display order. */
  items: FlowItem<TData>[];
  index: Map<ItemId, number>;
  /** Display index of the parent group, or -1. */
  parent: Int32Array;
  children: number[][];
  isGroup: Uint8Array;
  /** Index within the parent's children (or among top-level items). */
  siblingIndex: Int32Array;
  /** Drawable dependencies: valid endpoints and type, deduplicated. Includes cycle-ignored ones. */
  deps: ModelDep[];
  /** Per item, indices into `deps` of active (not ignored) incoming / outgoing dependencies. */
  inDeps: number[][];
  outDeps: number[][];
  start: Float64Array;
  end: Float64Array;
  maxUnits: number;
  errors: FlowDataError[];
  /** CSR adjacency of the split graph, only active edges. */
  edgeStart: Int32Array;
  edgeTo: Int32Array;
  /** Index into `deps` for explicit edges, -1 for implicit ones. */
  edgeDep: Int32Array;
  /** Longest path (display indices) and the dependencies it traverses. */
  longestPath: number[];
  pathDeps: Set<number>;
}

export interface ModelOptions {
  defaultSpan?: number;
  dependencyGap?: number;
}

/** Spans and gaps beyond this many base units are rejected so sums stay finite (D-14). */
export const MAX_UNITS = 1e6;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_UNITS;

export function buildModel<TData>(
  inputItems: readonly FlowItem<TData>[],
  inputDeps: readonly FlowDependency[],
  options: ModelOptions = {},
): Model<TData> {
  const errors: FlowDataError[] = [];
  const defaultSpan = options.defaultSpan ?? DEFAULT_SPAN;
  const defaultGap = options.dependencyGap ?? DEFAULT_GAP;

  // 1. Unique items (first occurrence wins).
  const byId = new Map<ItemId, FlowItem<TData>>();
  const unique: FlowItem<TData>[] = [];
  for (const item of Array.isArray(inputItems) ? inputItems : []) {
    if (item == null || typeof item !== "object") continue;
    if (typeof item.id !== "string") {
      errors.push({ code: "invalid-id", itemId: String(item.id) });
      continue;
    }
    if (byId.has(item.id)) {
      errors.push({ code: "duplicate-id", itemId: item.id });
      continue;
    }
    byId.set(item.id, item);
    unique.push(item);
  }

  // 2. Effective parents (DATA-1). Invalid parents put the item at top level.
  const effParent = new Map<ItemId, ItemId>();
  const kids = new Map<ItemId, FlowItem<TData>[]>();
  for (const item of unique) {
    const pid = item.parentId;
    if (pid === undefined || pid === null) continue;
    const p = byId.get(pid);
    if (!p) errors.push({ code: "unknown-parent", itemId: item.id });
    else if (p.kind !== "group") errors.push({ code: "invalid-parent", itemId: item.id });
    else if (item.kind === "group") errors.push({ code: "nested-group", itemId: item.id });
    else {
      effParent.set(item.id, pid);
      let list = kids.get(pid);
      if (!list) {
        list = [];
        kids.set(pid, list);
      }
      list.push(item);
    }
  }

  // 3. Display order (DATA-2): each group is followed by its children in array order.
  const items: FlowItem<TData>[] = [];
  for (const item of unique) {
    if (effParent.has(item.id)) continue;
    items.push(item);
    const list = item.kind === "group" ? kids.get(item.id) : undefined;
    if (list) for (const c of list) items.push(c);
  }
  const n = items.length;
  const index = new Map<ItemId, number>();
  for (let i = 0; i < n; i++) index.set(items[i]!.id, i);

  const parent = new Int32Array(n).fill(-1);
  const isGroup = new Uint8Array(n);
  const siblingIndex = new Int32Array(n);
  const children: number[][] = [];
  const span = new Float64Array(n);
  let topCount = 0;
  for (let i = 0; i < n; i++) {
    const item = items[i]!;
    children.push([]);
    isGroup[i] = item.kind === "group" ? 1 : 0;
    const pid = effParent.get(item.id);
    if (pid !== undefined) {
      const p = index.get(pid)!;
      parent[i] = p;
      siblingIndex[i] = children[p]!.length;
      children[p]!.push(i);
    } else siblingIndex[i] = topCount++;
    if ((item as { start?: unknown }).start !== undefined) {
      errors.push({ code: "unsupported-field", itemId: item.id, field: "start" });
    }
    span[i] = defaultSpan;
    if (!isGroup[i] && item.span !== undefined) {
      if (isNum(item.span) && item.span > 0) span[i] = item.span;
      else errors.push({ code: "invalid-number", itemId: item.id, field: "span" });
    }
  }

  // 4. Dependencies (DATA-6, 7, 8, and group/child pairs of DATA-9).
  const deps: ModelDep[] = [];
  const seenIds = new Set<string>();
  const seenPairs = new Set<number>();
  for (const dep of Array.isArray(inputDeps) ? inputDeps : []) {
    if (dep == null || typeof dep !== "object") continue;
    if (typeof dep.id !== "string") {
      errors.push({ code: "invalid-id", dependencyId: String(dep.id) });
      continue;
    }
    if (seenIds.has(dep.id)) {
      errors.push({ code: "duplicate-dependency-id", dependencyId: dep.id });
      continue;
    }
    seenIds.add(dep.id);
    if (dep.type !== undefined && dep.type !== "finish-to-start") {
      errors.push({ code: "unsupported-type", dependencyId: dep.id });
      continue;
    }
    const from = index.get(dep.from);
    const to = index.get(dep.to);
    if (from === undefined || to === undefined) {
      errors.push({ code: "unknown-endpoint", dependencyId: dep.id });
      continue;
    }
    if (from === to) {
      errors.push({ code: "self-dependency", dependencyId: dep.id });
      continue;
    }
    const pair = from * n + to;
    if (seenPairs.has(pair)) {
      errors.push({ code: "duplicate-dependency", dependencyId: dep.id });
      continue;
    }
    seenPairs.add(pair);
    let gap = defaultGap;
    if (dep.gap !== undefined) {
      if (isNum(dep.gap)) gap = dep.gap;
      else errors.push({ code: "invalid-number", dependencyId: dep.id, field: "gap" });
    }
    const ownGroup = parent[to] === from || parent[from] === to;
    if (ownGroup) errors.push({ code: "cycle", dependencyId: dep.id });
    deps.push({ dep, from, to, gap, ignored: ownGroup });
  }

  // 5. Split graph in CSR form.
  const outAll: number[][] = Array.from({ length: n }, () => []);
  for (let d = 0; d < deps.length; d++) if (!deps[d]!.ignored) outAll[deps[d]!.from]!.push(d);
  const nodeCount = 2 * n;
  const edgeStart = new Int32Array(nodeCount + 1);
  for (let i = 0; i < n; i++) {
    edgeStart[2 * i + 1] = children[i]!.length + 1;
    edgeStart[2 * i + 2] = outAll[i]!.length + (parent[i]! >= 0 ? 1 : 0);
  }
  for (let v = 0; v < nodeCount; v++) edgeStart[v + 1]! += edgeStart[v]!;
  const m = edgeStart[nodeCount]!;
  let edgeTo = new Int32Array(m);
  let edgeDep = new Int32Array(m);
  for (let i = 0; i < n; i++) {
    let e = edgeStart[2 * i]!;
    for (const c of children[i]!) {
      edgeTo[e] = 2 * c;
      edgeDep[e++] = -1;
    }
    edgeTo[e] = 2 * i + 1;
    edgeDep[e] = -1;
    e = edgeStart[2 * i + 1]!;
    for (const d of outAll[i]!) {
      edgeTo[e] = 2 * deps[d]!.to;
      edgeDep[e++] = d;
    }
    if (parent[i]! >= 0) {
      edgeTo[e] = 2 * parent[i]! + 1;
      edgeDep[e] = -1;
    }
  }

  // 6. Cycle breaking by DFS (DATA-9) and topological order (reverse post-order).
  const removed = new Uint8Array(m);
  const state = new Uint8Array(nodeCount); // 0 white, 1 on path, 2 done
  const stackPos = new Int32Array(nodeCount);
  const pathNode: number[] = [];
  const pathEdge: number[] = []; // next edge to explore per path entry
  const pathIn: number[] = []; // edge used to enter the node, -1 for roots
  const post: number[] = [];
  const cycleDeps: number[] = [];
  const ignoreDep = (e: number) => {
    removed[e] = 1;
    const d = edgeDep[e]!;
    deps[d]!.ignored = true;
    cycleDeps.push(d);
  };
  for (let r = 0; r < nodeCount; r++) {
    if (state[r] !== 0) continue;
    state[r] = 1;
    stackPos[r] = 0;
    pathNode.push(r);
    pathEdge.push(edgeStart[r]!);
    pathIn.push(-1);
    while (pathNode.length > 0) {
      const top = pathNode.length - 1;
      const v = pathNode[top]!;
      const e = pathEdge[top]!;
      if (e < edgeStart[v + 1]!) {
        pathEdge[top] = e + 1;
        if (removed[e]) continue;
        const w = edgeTo[e]!;
        if (state[w] === 0) {
          state[w] = 1;
          stackPos[w] = pathNode.length;
          pathNode.push(w);
          pathEdge.push(edgeStart[w]!);
          pathIn.push(e);
        } else if (state[w] === 1) {
          // Back edge: ignore the most recently traversed explicit dependency on the cycle.
          if (edgeDep[e]! >= 0) {
            ignoreDep(e);
            continue;
          }
          let k = top;
          const stop = stackPos[w]!;
          while (k > stop && edgeDep[pathIn[k]!]! < 0) k--;
          if (k === stop) continue; // implicit-only cycles cannot occur; defensive
          ignoreDep(pathIn[k]!);
          // Unwind to the source node of the ignored edge; popped nodes are explored again later.
          while (pathNode.length > k) {
            state[pathNode.pop()!] = 0;
            pathEdge.pop();
            pathIn.pop();
          }
        }
      } else {
        state[v] = 2;
        post.push(v);
        pathNode.pop();
        pathEdge.pop();
        pathIn.pop();
      }
    }
  }
  for (const d of cycleDeps) errors.push({ code: "cycle", dependencyId: deps[d]!.dep.id });

  // Compact the CSR arrays to active edges only.
  if (cycleDeps.length > 0) {
    const keptTo = new Int32Array(m - cycleDeps.length);
    const keptDep = new Int32Array(m - cycleDeps.length);
    let k = 0;
    for (let v = 0; v < nodeCount; v++) {
      const from = edgeStart[v]!;
      const to = edgeStart[v + 1]!;
      edgeStart[v] = k;
      for (let e = from; e < to; e++) {
        if (removed[e]) continue;
        keptTo[k] = edgeTo[e]!;
        keptDep[k++] = edgeDep[e]!;
      }
    }
    edgeStart[nodeCount] = k;
    edgeTo = keptTo;
    edgeDep = keptDep;
  }

  // 7. Positions (LAY-2 to LAY-7) by relaxation in topological order.
  const val = new Float64Array(nodeCount);
  for (let p = post.length - 1; p >= 0; p--) {
    const v = post[p]!;
    const i = v >> 1;
    const isStart = (v & 1) === 0;
    for (let e = edgeStart[v]!; e < edgeStart[v + 1]!; e++) {
      const w = edgeTo[e]!;
      const d = edgeDep[e]!;
      if (d >= 0) {
        const contrib = Math.max(val[v]! + deps[d]!.gap, val[2 * i]!);
        if (contrib > val[w]!) val[w] = contrib;
      } else if (isStart && w === v + 1) {
        if (!isGroup[i]) val[w] = val[v]! + span[i]!;
        else if (children[i]!.length === 0) val[w] = val[v]! + defaultSpan;
      } else if (val[v]! > val[w]!) val[w] = val[v]!;
    }
  }
  const start = new Float64Array(n);
  const end = new Float64Array(n);
  let maxUnits = 0;
  for (let i = 0; i < n; i++) {
    start[i] = val[2 * i]!;
    end[i] = val[2 * i + 1]!;
    if (end[i]! > maxUnits) maxUnits = end[i]!;
  }

  const inDeps: number[][] = Array.from({ length: n }, () => []);
  const outDeps: number[][] = Array.from({ length: n }, () => []);
  for (let d = 0; d < deps.length; d++) {
    const md = deps[d]!;
    if (md.ignored) continue;
    inDeps[md.to]!.push(d);
    outDeps[md.from]!.push(d);
  }

  const model: Model<TData> = {
    items,
    index,
    parent,
    children,
    isGroup,
    siblingIndex,
    deps,
    inDeps,
    outDeps,
    start,
    end,
    maxUnits,
    errors,
    edgeStart,
    edgeTo,
    edgeDep,
    longestPath: [],
    pathDeps: new Set(),
  };
  computeLongestPath(model);
  return model;
}

/** Contribution of dependency d to its successor's start (DATA-15 clamp). */
export function contribution(model: Model, d: number): number {
  const md = model.deps[d]!;
  return Math.max(model.end[md.from]! + md.gap, model.start[md.from]!);
}

/** X-2: chain of leaves that determines the latest end. */
function computeLongestPath(model: Model): void {
  const { items, isGroup, children, start, end, parent, inDeps } = model;
  let cur = -1;
  for (let i = 0; i < items.length; i++) {
    if (isGroup[i] && children[i]!.length > 0) continue;
    if (cur < 0 || end[i]! > end[cur]! + EPS) cur = i;
  }
  if (cur < 0) return;
  const path = [cur];
  const seen = new Set(path);
  for (;;) {
    let best = -1;
    let bestDep = -1;
    const consider = (target: number, at: number) => {
      for (const d of inDeps[target]!) {
        if (Math.abs(contribution(model, d) - at) > EPS) continue;
        const from = model.deps[d]!.from;
        if (best < 0 || from < best) {
          best = from;
          bestDep = d;
        }
      }
    };
    consider(cur, start[cur]!);
    const p = parent[cur]!;
    if (p >= 0 && Math.abs(start[cur]! - start[p]!) <= EPS) consider(p, start[p]!);
    if (best < 0) break;
    let next = best;
    if (isGroup[next] && children[next]!.length > 0) {
      let c = -1;
      for (const k of children[next]!) if (c < 0 || end[k]! > end[c]! + EPS) c = k;
      next = c;
    }
    if (seen.has(next)) break;
    model.pathDeps.add(bestDep);
    seen.add(next);
    path.push(next);
    cur = next;
  }
  model.longestPath = path.reverse();
}

/** Reverse CSR adjacency of the active split graph. */
export function reverseEdges(model: Model): { start: Int32Array; from: Int32Array } {
  const nodes = model.edgeStart.length - 1;
  const start = new Int32Array(nodes + 1);
  for (let e = 0; e < model.edgeTo.length; e++) start[model.edgeTo[e]! + 1]!++;
  for (let v = 0; v < nodes; v++) start[v + 1]! += start[v]!;
  const fill = start.slice(0, nodes);
  const from = new Int32Array(model.edgeTo.length);
  for (let v = 0; v < nodes; v++) {
    for (let e = model.edgeStart[v]!; e < model.edgeStart[v + 1]!; e++) from[fill[model.edgeTo[e]!]!++] = v;
  }
  return { start, from };
}

/** Marks every node reachable from `seeds` along the given adjacency. */
export function reach(seeds: readonly number[], start: Int32Array, to: Int32Array): Uint8Array {
  const mark = new Uint8Array(start.length - 1);
  const stack = [...seeds];
  for (const s of seeds) mark[s] = 1;
  while (stack.length > 0) {
    const v = stack.pop()!;
    for (let e = start[v]!; e < start[v + 1]!; e++) {
      const w = to[e]!;
      if (!mark[w]) {
        mark[w] = 1;
        stack.push(w);
      }
    }
  }
  return mark;
}
