// Data sets shared by tests, the demo page and benchmarks.

import type { FlowDependency, FlowItem } from "../src/layout/types";

export interface JobData {
  jobId?: number;
  delayMs?: number;
  repeat?: { type: "SEQUENTIAL" | "PARALLEL"; times: number };
}

export type DemoItem = FlowItem<JobData>;

/** Spec section 16 "reference example" data set. */
export function referenceExample(): { items: DemoItem[]; dependencies: FlowDependency[]; origin: Date } {
  const items: DemoItem[] = [
    { id: "setup", kind: "group", label: "Setup" },
    { id: "login", kind: "leaf", parentId: "setup", label: "Login", data: { jobId: 101 } },
    { id: "stock", kind: "leaf", parentId: "setup", label: "Check stock", data: { jobId: 102, delayMs: 10_000 } },
    { id: "sales", kind: "group", label: "Sales flow" },
    { id: "order", kind: "leaf", parentId: "sales", label: "Create sales order", data: { jobId: 103 } },
    {
      id: "invoice",
      kind: "leaf",
      parentId: "sales",
      label: "Post invoice",
      data: { jobId: 104, repeat: { type: "PARALLEL", times: 3 } },
    },
    { id: "mrp", kind: "leaf", label: "Run MRP", data: { jobId: 105, delayMs: 60_000 } },
    { id: "month", kind: "group", label: "Month end" },
    { id: "export", kind: "leaf", parentId: "month", label: "Export report", data: { jobId: 106 } },
    { id: "close", kind: "leaf", parentId: "month", label: "Close period", data: { jobId: 107 } },
    {
      id: "mail",
      kind: "leaf",
      parentId: "month",
      label: "Send summary mail",
      data: { jobId: 108, repeat: { type: "SEQUENTIAL", times: 2 } },
    },
  ];
  const dep = (id: string, from: string, to: string): FlowDependency => ({
    id,
    from,
    to,
    type: "finish-to-start",
    gap: 0.5,
  });
  const dependencies = [
    dep("d1", "login", "stock"),
    dep("d2", "setup", "sales"),
    dep("d3", "order", "invoice"),
    dep("d4", "sales", "month"),
    dep("d5", "mrp", "month"),
    dep("d6", "export", "close"),
    dep("d7", "close", "mail"),
  ];
  return { items, dependencies, origin: new Date(2026, 10, 20, 9, 0, 0) };
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random DAG of groups with leaves. Dependencies only go forward in display order
 * (between siblings, or from an earlier group to a later group), so there are no cycles.
 */
export function generateDataset(opts: {
  groups: number;
  leavesPerGroup: number;
  dependencies: number;
  seed?: number;
}): { items: DemoItem[]; dependencies: FlowDependency[]; origin: Date } {
  const rand = rng(opts.seed ?? 42);
  const items: DemoItem[] = [];
  const groupIds: string[] = [];
  const leavesOf: string[][] = [];
  let job = 1;
  for (let g = 0; g < opts.groups; g++) {
    const gid = `g${g}`;
    groupIds.push(gid);
    items.push({ id: gid, kind: "group", label: `Group ${g + 1}` });
    const leaves: string[] = [];
    for (let l = 0; l < opts.leavesPerGroup; l++) {
      const id = `g${g}-l${l}`;
      leaves.push(id);
      const delayMs = rand() < 0.15 ? 5000 : 0;
      items.push({ id, kind: "leaf", parentId: gid, label: `Job ${job}`, data: { jobId: job++, delayMs } });
    }
    leavesOf.push(leaves);
  }
  const dependencies: FlowDependency[] = [];
  const seen = new Set<string>();
  let guard = 0;
  while (dependencies.length < opts.dependencies && guard++ < opts.dependencies * 20) {
    let from: string;
    let to: string;
    if (rand() < 0.7 && opts.leavesPerGroup > 1) {
      const leaves = leavesOf[Math.floor(rand() * opts.groups)]!;
      const a = Math.floor(rand() * leaves.length);
      const b = Math.floor(rand() * leaves.length);
      if (a === b) continue;
      from = leaves[Math.min(a, b)]!;
      to = leaves[Math.max(a, b)]!;
    } else {
      const a = Math.floor(rand() * opts.groups);
      const b = Math.min(opts.groups - 1, a + 1 + Math.floor(rand() * 3));
      if (a === b) continue;
      from = groupIds[a]!;
      to = groupIds[b]!;
    }
    const key = `${from}>${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dependencies.push({ id: `d${dependencies.length}`, from, to, type: "finish-to-start", gap: 0.5 });
  }
  return { items, dependencies, origin: new Date(2026, 10, 20, 9, 0, 0) };
}

/** Spec section 14 reference data set: 60 groups, 540 leaves, about 400 dependencies. */
export const reference600 = () => generateDataset({ groups: 60, leavesPerGroup: 9, dependencies: 400, seed: 600 });

/** 5,000 rows and 5,000 dependencies. */
export const large5000 = () => generateDataset({ groups: 500, leavesPerGroup: 9, dependencies: 5000, seed: 5000 });

/** Example host bar variant rule (spec REN-18). */
export function exampleBarVariant(item: DemoItem, ctx: { predecessors: readonly unknown[] }): string {
  if (item.kind === "group") return "group";
  if ((item.data?.delayMs ?? 0) > 0) return "delayed";
  return ctx.predecessors.length > 0 ? "dependent" : "default";
}

/** Example host canConnect rule (spec INT-16): same parent only. */
export function exampleCanConnect(ctx: { from: DemoItem; to: DemoItem }): boolean {
  return (ctx.from.parentId ?? null) === (ctx.to.parentId ?? null);
}
