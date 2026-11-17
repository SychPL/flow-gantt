// Pure geometry helpers for the timeline (no React, no DOM).

import type { BaseUnit, FlowDataError } from "./layout/types.js";
import type { ZoomLevel } from "./types.js";

export const DEFAULT_ZOOM_LEVELS: readonly ZoomLevel[] = [
  { id: "1min", unit: "minute", step: 1, minColumnWidth: 100, label: "1 min" },
  { id: "5min", unit: "minute", step: 5, minColumnWidth: 100, label: "5 min" },
  { id: "10min", unit: "minute", step: 10, minColumnWidth: 100, label: "10 min" },
  { id: "15min", unit: "minute", step: 15, minColumnWidth: 100, label: "15 min" },
  { id: "30min", unit: "minute", step: 30, minColumnWidth: 100, label: "30 min" },
  { id: "1h", unit: "hour", step: 1, minColumnWidth: 100, label: "1 hour" },
];

export const MAX_CONTENT_WIDTH = 2_000_000;
export const STUB = 12;
export const MIN_BAR_WIDTH = 6;
export const DOT_RADIUS = 4;

/** Clamps a numeric option (DATA-15), reporting invalid or out-of-range values. */
export function clampOption(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  name: string,
  errors: FlowDataError[],
): number {
  if (value === undefined) return Math.min(Math.max(fallback, min), max);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ code: "invalid-option", detail: name });
    return Math.min(Math.max(fallback, min), max);
  }
  if (value < min || value > max) {
    errors.push({ code: "invalid-option", detail: name });
    return Math.min(Math.max(value, min), max);
  }
  return value;
}

/** Validates the zoom level list; falls back to the defaults when unusable. */
export function resolveZoomLevels(levels: readonly ZoomLevel[] | undefined, errors: FlowDataError[]): ZoomLevel[] {
  if (levels === undefined) return [...DEFAULT_ZOOM_LEVELS];
  const out: ZoomLevel[] = [];
  const ids = new Set<string>();
  for (const l of Array.isArray(levels) ? levels : []) {
    if (!l || typeof l.id !== "string" || ids.has(l.id) || (l.unit !== "minute" && l.unit !== "hour")) {
      errors.push({ code: "invalid-option", detail: "zoomLevels" });
      continue;
    }
    let step = l.step;
    if (!Number.isInteger(step) || step < 1) {
      errors.push({ code: "invalid-option", detail: `zoomLevels.${l.id}.step` });
      step = Number.isFinite(step) && step >= 1 ? Math.round(step) : 1;
    }
    const minColumnWidth = clampOption(l.minColumnWidth, 100, 8, 2000, `zoomLevels.${l.id}.minColumnWidth`, errors);
    ids.add(l.id);
    out.push({ ...l, step, minColumnWidth });
  }
  if (out.length === 0) {
    errors.push({ code: "invalid-option", detail: "zoomLevels" });
    return [...DEFAULT_ZOOM_LEVELS];
  }
  return out;
}

/** ZOOM-1: pixels per base unit at a zoom level. */
export function pxPerUnit(level: ZoomLevel, baseUnit: BaseUnit): number {
  const zoomUnitInBase = level.unit === baseUnit ? 1 : level.unit === "hour" ? 60 : 1 / 60;
  return level.minColumnWidth / (level.step * zoomUnitInBase);
}

/** REN-9: column count of the content (one leading column, content, two trailing columns). */
export function contentColumns(maxUnits: number, ppu: number, colW: number): number {
  return 1 + Math.ceil((maxUnits * ppu) / colW - 1e-9) + 2;
}

/**
 * Picks the effective zoom level (DATA-15): the requested one, or the coarsest level when
 * the content would exceed MAX_CONTENT_WIDTH.
 */
export function effectiveZoom(
  levels: readonly ZoomLevel[],
  requested: number,
  maxUnits: number,
  baseUnit: BaseUnit,
): { index: number; tooLarge: boolean } {
  const widthAt = (i: number) => {
    const l = levels[i]!;
    return contentColumns(maxUnits, pxPerUnit(l, baseUnit), l.minColumnWidth) * l.minColumnWidth;
  };
  if (widthAt(requested) <= MAX_CONTENT_WIDTH) return { index: requested, tooLarge: false };
  return { index: levels.length - 1, tooLarge: true };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * REN-20 to REN-22: orthogonal connector from the source's right edge (sx, sy) to the
 * target's left edge (tx, ty). Returns the polyline ending where the end marker sits.
 */
export function routeConnector(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  sourceRowTop: number,
  rowHeight: number,
  endInset: number,
): Point[] {
  const end = tx - endInset;
  if (tx >= sx + 2 * STUB) {
    const vx = sx + STUB;
    return [
      { x: sx, y: sy },
      { x: vx, y: sy },
      { x: vx, y: ty },
      { x: end, y: ty },
    ];
  }
  const yb = ty > sy ? sourceRowTop + rowHeight : sourceRowTop;
  return [
    { x: sx, y: sy },
    { x: sx + STUB, y: sy },
    { x: sx + STUB, y: yb },
    { x: tx - STUB, y: yb },
    { x: tx - STUB, y: ty },
    { x: end, y: ty },
  ];
}

export const pathData = (points: readonly Point[]) =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join(" ");

const round = (v: number) => Math.round(v * 10) / 10;

/** Ease-out cubic. */
export const ease = (t: number) => 1 - (1 - t) ** 3;

/** Parses a CSS time ("150ms", "0.2s") into milliseconds. */
export function parseDuration(value: string, fallback: number): number {
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return v.endsWith("ms") ? n : v.endsWith("s") ? n * 1000 : n;
}

/** ZOOM-5 default label: HH:mm for minute levels, HH:00 for hour levels, date at midnight. */
export function defaultScaleLabel(date: Date, level: ZoomLevel): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = level.unit === "hour" ? "00" : String(date.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;
  if (date.getHours() === 0 && date.getMinutes() === 0) {
    return `${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
  }
  return time;
}
