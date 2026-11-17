// Internal helpers shared by computeLayout and the component (not a public entry).

import type { Model } from "./model.js";
import { DEFAULT_GAP, DEFAULT_SPAN, MAX_UNITS } from "./model.js";
import type { BaseUnit, FlowDataError, FlowLayout, FlowLayoutEntry, ItemId } from "./types.js";

const UNIT_MS: Record<BaseUnit, number> = { minute: 60_000, hour: 3_600_000 };

export interface ResolvedLayoutOptions {
  baseUnit: BaseUnit;
  defaultSpan: number;
  dependencyGap: number;
  errors: FlowDataError[];
}

/** Applies defaults and reports invalid option values (DATA-15). */
export function resolveLayoutOptions(input: {
  baseUnit?: unknown;
  defaultSpan?: unknown;
  dependencyGap?: unknown;
}): ResolvedLayoutOptions {
  const errors: FlowDataError[] = [];
  let baseUnit: BaseUnit = "minute";
  if (input.baseUnit !== undefined) {
    if (input.baseUnit === "minute" || input.baseUnit === "hour") baseUnit = input.baseUnit;
    else errors.push({ code: "invalid-option", detail: "baseUnit" });
  }
  let defaultSpan = DEFAULT_SPAN;
  if (input.defaultSpan !== undefined) {
    const v = input.defaultSpan;
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_UNITS) defaultSpan = v;
    else errors.push({ code: "invalid-option", detail: "defaultSpan" });
  }
  let dependencyGap = DEFAULT_GAP;
  if (input.dependencyGap !== undefined) {
    const v = input.dependencyGap;
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_UNITS) dependencyGap = v;
    else errors.push({ code: "invalid-option", detail: "dependencyGap" });
  }
  return { baseUnit, defaultSpan, dependencyGap, errors };
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/** Builds the public layout object from a model. */
export function layoutFromModel(
  model: Model,
  origin: Date,
  baseUnit: BaseUnit,
  extraErrors: readonly FlowDataError[],
): FlowLayout {
  const originMs = isValidDate(origin) ? origin.getTime() : Number.NaN;
  const unitMs = UNIT_MS[baseUnit];
  const entries = new Map<ItemId, FlowLayoutEntry>();
  for (let i = 0; i < model.items.length; i++) {
    const startUnits = model.start[i]!;
    const endUnits = model.end[i]!;
    entries.set(model.items[i]!.id, {
      id: model.items[i]!.id,
      startUnits,
      endUnits,
      start: new Date(originMs + startUnits * unitMs),
      end: new Date(originMs + endUnits * unitMs),
    });
  }
  const errors = [...extraErrors, ...model.errors];
  if (!isValidDate(origin)) errors.unshift({ code: "invalid-origin", detail: String(origin) });
  return {
    entries,
    minUnits: 0,
    maxUnits: model.maxUnits,
    errors,
    longestPath: model.longestPath.map((i) => model.items[i]!.id),
  };
}
