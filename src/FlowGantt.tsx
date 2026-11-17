import {
  type CSSProperties,
  forwardRef,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  clampOption,
  contentColumns,
  DOT_RADIUS,
  defaultScaleLabel,
  ease,
  effectiveZoom,
  MAX_CONTENT_WIDTH,
  MIN_BAR_WIDTH,
  parseDuration,
  pathData,
  pxPerUnit,
  resolveZoomLevels,
  routeConnector,
  STUB,
} from "./geometry.js";
import { buildModel, type Model, reach, reverseEdges } from "./layout/model.js";
import { isValidDate, layoutFromModel, resolveLayoutOptions } from "./layout/resolve.js";
import type { FlowDataError, FlowDependency, FlowItem, FlowLayout, ItemId, ItemStatus } from "./layout/types.js";
import { defaultMessages } from "./messages.js";
import { Bar, GridRow, type ResolvedColumn, renderGroupFrames } from "./parts.js";
import type {
  Box,
  FlowColumn,
  FlowContextMenuEvent,
  FlowContextMenuTarget,
  FlowGanttHandle,
  FlowGanttProps,
  FlowMessages,
  ItemBoxes,
  LayerContext,
  ReorderChange,
} from "./types.js";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const OVERSCAN = 5;
const INTERACTIVE = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"]';
const DRAG_THRESHOLD = 4;
const LONG_PRESS_MS = 550;
const EDGE = 32;
const MAX_ANIMATED = 500;
const DEFAULT_SIZE = { width: 1024, height: 600 };
/** Viewport sizes beyond this are treated as this size, which bounds the rendered window. */
const MAX_VIEWPORT = 16_384;
const EMPTY_IDS: readonly ItemId[] = [];
const DEFAULT_COLUMNS: readonly FlowColumn<never>[] = [{ id: "label", header: "", width: "fill", tree: true }];

type Hit =
  | { area: "grid"; row: number; toggle: boolean }
  | { area: "timeline"; bar: number; handle?: "left" | "right" }
  | { area: "timeline"; dep: number }
  | { area: "grid" | "timeline" | "header" | "other" };

interface Rows {
  order: Int32Array;
  rowOf: Int32Array;
}

interface LinkDrag {
  from: number;
  x: number;
  y: number;
  target: number;
  valid: boolean;
}

interface ReorderDrag {
  item: number;
  change: { parent: number; index: number } | null;
  marker: number;
  valid: boolean;
}

type Press =
  | {
      kind: "timeline" | "grid";
      pointerId: number;
      touch: boolean;
      x0: number;
      y0: number;
      left0: number;
      top0: number;
      hit: Hit;
      moved: boolean;
      mods: { shift: boolean; ctrl: boolean };
    }
  | { kind: "link"; pointerId: number }
  | { kind: "reorder"; pointerId: number }
  | { kind: "splitter"; pointerId: number; x0: number; w0: number };

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function computeRows(model: Model, collapsed: ReadonlySet<ItemId>): Rows {
  const n = model.items.length;
  const rowOf = new Int32Array(n).fill(-1);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = model.parent[i]!;
    if (p >= 0 && collapsed.has(model.items[p]!.id)) continue;
    rowOf[i] = order.length;
    order.push(i);
  }
  return { order: Int32Array.from(order), rowOf };
}

/** X-1 and X-8: which items and dependencies stay at full opacity (null: nothing dimmed). */
function computeHighlight(
  model: Model,
  rev: () => { start: Int32Array; from: Int32Array },
  source: number,
  mode: "none" | "direct" | "full",
  highlighted: ReadonlySet<ItemId> | null,
): { items: Uint8Array; deps: Uint8Array } | null {
  const n = model.items.length;
  let items: Uint8Array | null = null;
  let deps: Uint8Array | null = null;
  if (source >= 0 && mode !== "none") {
    items = new Uint8Array(n);
    deps = new Uint8Array(model.deps.length);
    items[source] = 1;
    if (mode === "direct") {
      for (const d of model.inDeps[source]!) {
        items[model.deps[d]!.from] = 1;
        deps[d] = 1;
      }
      for (const d of model.outDeps[source]!) {
        items[model.deps[d]!.to] = 1;
        deps[d] = 1;
      }
    } else {
      const seeds = [2 * source, 2 * source + 1];
      const fwd = reach(seeds, model.edgeStart, model.edgeTo);
      const r = rev();
      const bwd = reach(seeds, r.start, r.from);
      for (let i = 0; i < n; i++) {
        if (fwd[2 * i] || fwd[2 * i + 1] || bwd[2 * i] || bwd[2 * i + 1]) items[i] = 1;
      }
      for (let d = 0; d < model.deps.length; d++) {
        const md = model.deps[d]!;
        if (md.ignored) continue;
        const u = 2 * md.from + 1;
        const w = 2 * md.to;
        if ((fwd[u] && fwd[w]) || (bwd[u] && bwd[w])) deps[d] = 1;
      }
    }
  }
  if (highlighted && highlighted.size > 0) {
    const inSet = new Uint8Array(n);
    for (const id of highlighted) {
      const i = model.index.get(id);
      if (i !== undefined) inSet[i] = 1;
    }
    if (!items || !deps) {
      items = new Uint8Array(n).fill(1);
      deps = new Uint8Array(model.deps.length).fill(1);
    }
    for (let i = 0; i < n; i++) if (!inSet[i]) items[i] = 0;
    for (let d = 0; d < model.deps.length; d++) {
      const md = model.deps[d]!;
      if (!inSet[md.from] || !inSet[md.to]) deps[d] = 0;
    }
  }
  return items && deps ? { items, deps } : null;
}

function sameLayout(a: FlowLayout | null, b: FlowLayout): boolean {
  if (!a || a.entries.size !== b.entries.size || a.maxUnits !== b.maxUnits) return false;
  for (const [id, e] of b.entries) {
    const o = a.entries.get(id);
    if (!o || o.startUnits !== e.startUnits || o.endUnits !== e.endUnits || o.start.getTime() !== e.start.getTime())
      return false;
  }
  return (
    a.longestPath.join("\u0000") === b.longestPath.join("\u0000") &&
    JSON.stringify(a.errors) === JSON.stringify(b.errors)
  );
}

/** X-6: animated positions after data edits. Returns the positions to draw. */
function useAnimatedPositions(
  model: Model,
  rows: Rows,
  enabled: boolean,
  rootRef: React.RefObject<HTMLDivElement | null>,
): { start: Float64Array; end: Float64Array } {
  const [frame, setFrame] = useState<{ model: Model; start: Float64Array; end: Float64Array } | null>(null);
  const shown = useRef<{ model: Model; start: Float64Array; end: Float64Array } | null>(null);
  const raf = useRef(0);
  const current = frame && frame.model === model ? frame : null;
  useIsoLayoutEffect(() => {
    const prev = shown.current;
    shown.current = { model, start: model.start, end: model.end };
    cancelAnimationFrame(raf.current);
    if (!prev || prev.model === model) return;
    if (!enabled || prefersReducedMotion() || !rootRef.current) {
      setFrame(null);
      return;
    }
    const n = model.items.length;
    const fromStart = Float64Array.from(model.start);
    const fromEnd = Float64Array.from(model.end);
    const movingIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = prev.model.index.get(model.items[i]!.id);
      if (j === undefined) continue;
      fromStart[i] = prev.start[j]!;
      fromEnd[i] = prev.end[j]!;
      if (fromStart[i] !== model.start[i] || fromEnd[i] !== model.end[i]) movingIdx.push(i);
    }
    let moving = 0;
    for (const i of movingIdx) if (rows.rowOf[i]! >= 0) moving++;
    const duration = parseDuration(
      getComputedStyle(rootRef.current).getPropertyValue("--fg-motion-duration") || "150ms",
      150,
    );
    if (moving === 0 || moving > MAX_ANIMATED || duration <= 0) {
      setFrame(null);
      return;
    }
    const t0 = performance.now();
    const s = Float64Array.from(fromStart);
    const e = Float64Array.from(fromEnd);
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      if (t >= 1) {
        shown.current = { model, start: model.start, end: model.end };
        setFrame(null);
        return;
      }
      // Only moving items are touched per frame; the arrays are reused.
      const k = ease(t);
      for (const i of movingIdx) {
        s[i] = fromStart[i]! + (model.start[i]! - fromStart[i]!) * k;
        e[i] = fromEnd[i]! + (model.end[i]! - fromEnd[i]!) * k;
      }
      shown.current = { model, start: s, end: e };
      setFrame({ model, start: s, end: e });
      raf.current = requestAnimationFrame(step);
    };
    shown.current = { model, start: fromStart, end: fromEnd };
    setFrame({ model, start: fromStart, end: fromEnd });
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [model]);
  return current ?? model;
}

function FlowGanttInner<TData>(props: FlowGanttProps<TData>, ref: Ref<FlowGanttHandle>): ReactElement {
  const {
    items,
    dependencies,
    origin,
    initialSize,
    zoomLevel,
    defaultZoomLevel,
    resizableGrid = false,
    showTimeScale = true,
    readOnly = false,
    groupFrames = true,
    chainHighlight = "full",
    highlightLongestPath = false,
    stickyGroupHeaders = true,
    animateLayout = true,
    previewDependencyLayout = true,
    linkEndMarker = "dot",
  } = props;
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  useIsoLayoutEffect(() => {
    propsRef.current = props;
  });

  const messages: FlowMessages = useMemo(() => ({ ...defaultMessages, ...props.messages }), [props.messages]);

  // ---- options and model ------------------------------------------------------------------
  const layoutOpts = useMemo(
    () =>
      resolveLayoutOptions({
        baseUnit: props.baseUnit,
        defaultSpan: props.defaultSpan,
        dependencyGap: props.dependencyGap,
      }),
    [props.baseUnit, props.defaultSpan, props.dependencyGap],
  );
  const model = useMemo(
    () => buildModel(items, dependencies, layoutOpts),
    [items, dependencies, layoutOpts],
  ) as Model<TData>;
  const originMs = isValidDate(origin) ? origin.getTime() : Number.NaN;
  const layout = useMemo(
    () => layoutFromModel(model, new Date(originMs), layoutOpts.baseUnit, layoutOpts.errors),
    [model, originMs, layoutOpts],
  );
  const timelineOn = !Number.isNaN(originMs);
  const revEdges = useMemo(() => {
    let cache: ReturnType<typeof reverseEdges> | null = null;
    return () => {
      cache ??= reverseEdges(model);
      return cache;
    };
  }, [model]);
  const pairs = useMemo(() => {
    const s = new Set<number>();
    const n = model.items.length;
    for (const d of model.deps) s.add(d.from * n + d.to);
    return s;
  }, [model]);

  const sizes = useMemo(() => {
    const errors: FlowDataError[] = [];
    const rowH = clampOption(props.rowHeight, 36, 16, 200, "rowHeight", errors);
    const barH = clampOption(props.barHeight, rowH - 5, 4, rowH, "barHeight", errors);
    const headerH = clampOption(props.headerHeight, 35, 0, 200, "headerHeight", errors);
    const gridW = clampOption(props.gridWidth, 360, 0, 2000, "gridWidth", errors);
    const levels = resolveZoomLevels(props.zoomLevels, errors);
    return { rowH, barH, headerH, gridW, levels, errors };
  }, [props.rowHeight, props.barHeight, props.headerHeight, props.gridWidth, props.zoomLevels]);
  const { rowH, barH, headerH, levels } = sizes;
  const [gridOverride, setGridOverride] = useState<number | null>(null);
  const gridW = resizableGrid && gridOverride !== null ? gridOverride : sizes.gridW;

  // ---- state: collapse, selection, zoom ----------------------------------------------------
  const [innerCollapsed, setInnerCollapsed] = useState<readonly ItemId[]>(() => props.defaultCollapsedIds ?? EMPTY_IDS);
  const collapsedList = props.collapsedIds ?? innerCollapsed;
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const [innerSelected, setInnerSelected] = useState<readonly ItemId[]>(() => props.defaultSelectedIds ?? EMPTY_IDS);
  const selectedList = props.selectedIds ?? innerSelected;
  const selected = useMemo(() => new Set(selectedList), [selectedList]);
  const [innerZoom, setInnerZoom] = useState(defaultZoomLevel ?? "1min");
  const zoomErrors: FlowDataError[] = [];
  const requestedId = zoomLevel ?? innerZoom;
  let requested = levels.findIndex((l) => l.id === requestedId);
  if (requested < 0) {
    if (zoomLevel !== undefined || defaultZoomLevel !== undefined)
      zoomErrors.push({ code: "invalid-option", detail: "zoomLevel" });
    requested = Math.max(
      0,
      levels.findIndex((l) => l.id === "1min"),
    );
  }
  const zoom = effectiveZoom(levels, requested, model.maxUnits, layoutOpts.baseUnit);
  const level = levels[zoom.index]!;
  const ppu = pxPerUnit(level, layoutOpts.baseUnit);
  const colW = level.minColumnWidth;

  const rows = useMemo(() => computeRows(model, collapsed), [model, collapsed]);
  const rowCount = rows.order.length;
  const pos = useAnimatedPositions(model, rows, animateLayout, rootRef);

  // ---- size and scroll ---------------------------------------------------------------------
  const okSize = (v: unknown) => typeof v === "number" && v > 0 && v <= MAX_VIEWPORT;
  const fallbackSize =
    initialSize && okSize(initialSize.width) && okSize(initialSize.height) ? initialSize : DEFAULT_SIZE;
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const size =
    measured && measured.width > 0 && measured.height > 0
      ? { width: Math.min(measured.width, MAX_VIEWPORT), height: Math.min(measured.height, MAX_VIEWPORT) }
      : fallbackSize;
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const tlVisibleW = Math.max(0, size.width - gridW);
  const bodyVisibleH = Math.max(0, size.height - headerH);
  const columns = contentColumns(model.maxUnits, ppu, colW);
  const rawWidth = columns * colW;
  if (zoom.tooLarge) zoomErrors.push({ code: "extent-too-large", detail: `${Math.round(rawWidth)}px` });
  const contentW = timelineOn ? Math.max(tlVisibleW, Math.min(MAX_CONTENT_WIDTH, rawWidth)) : tlVisibleW;
  const bodyH = Math.max(rowCount * rowH, bodyVisibleH);

  // ---- interaction state -------------------------------------------------------------------
  const [hoverId, setHoverId] = useState<ItemId | null>(null);
  const [activeId, setActiveId] = useState<ItemId | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const [kbMode, setKbMode] = useState(false);
  const [linkDrag, setLinkDragState] = useState<LinkDrag | null>(null);
  const linkRef = useRef<LinkDrag | null>(null);
  const setLinkDrag = (v: LinkDrag | null) => {
    linkRef.current = v;
    setLinkDragState(v);
  };
  const [kbLink, setKbLink] = useState<{ from: number; target: number; valid: boolean } | null>(null);
  const [reorderDrag, setReorderDragState] = useState<ReorderDrag | null>(null);
  const reorderRef = useRef<ReorderDrag | null>(null);
  const setReorderDrag = (v: ReorderDrag | null) => {
    reorderRef.current = v;
    setReorderDragState(v);
  };
  const [panning, setPanning] = useState(false);
  const [flash, setFlash] = useState<{ id: ItemId; n: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pressRef = useRef<Press | null>(null);
  const anchorRef = useRef<ItemId | null>(null);
  const pendingScroll = useRef<{ levelId: string; left?: number; top?: number } | null>(null);
  const pendingFocus = useRef<ItemId | null>(null);
  const kbMenu = useRef({ at: Number.NEGATIVE_INFINITY, handled: false });
  const lastPressHit = useRef<Hit | null>(null);
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | 0; fired: boolean; handled: boolean }>({
    timer: 0,
    fired: false,
    handled: false,
  });
  const captured = useRef<number | null>(null);
  const wheelAcc = useRef(0);
  const autoScroll = useRef<{ vx: number; vy: number; raf: number; cx: number; cy: number }>({
    vx: 0,
    vy: 0,
    raf: 0,
    cx: 0,
    cy: 0,
  });
  const rectRef = useRef<DOMRect | null>(null);
  const validity = useRef<{ from: number; model: Model; upstream: Uint8Array; cache: Map<number, boolean> } | null>(
    null,
  );

  const announce = useCallback((text: string) => {
    if (text) setAnnouncement((prev) => (prev === text ? `${text} ` : text));
  }, []);

  // ---- geometry helpers --------------------------------------------------------------------
  const barBox = (i: number, r: number): Box => {
    const left = colW + pos.start[i]! * ppu;
    const width = Math.max(MIN_BAR_WIDTH, (pos.end[i]! - pos.start[i]!) * ppu);
    return { left, top: r * rowH + Math.floor((rowH - barH) / 2), width, height: barH };
  };
  const rowBox = (r: number): Box => ({ left: 0, top: r * rowH, width: contentW, height: rowH });
  const geo = { barBox, rowBox, rowH, headerH, gridW, colW, ppu, tlVisibleW, bodyVisibleH, contentW, bodyH };
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const topLevel = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < model.items.length; i++) if (model.parent[i]! < 0) out.push(i);
    return out;
  }, [model]);
  const snapshot = { model, rows, selectedList, collapsed, collapsedList, level, levels, requested, topLevel };
  const stateRef = useRef(snapshot);
  stateRef.current = snapshot;

  const activeIdx = activeId !== null ? (model.index.get(activeId) ?? -1) : -1;
  const activeRow = activeIdx >= 0 ? rows.rowOf[activeIdx]! : -1;
  const effectiveActiveRow = activeRow >= 0 ? activeRow : rowCount > 0 ? 0 : -1;

  // ---- callbacks to the host ---------------------------------------------------------------
  const setSelection = useCallback((ids: ItemId[], source: "pointer" | "keyboard" | "api") => {
    const cur = stateRef.current.selectedList;
    if (ids.length === cur.length && ids.every((id, k) => id === cur[k])) return;
    if (propsRef.current.selectedIds === undefined) setInnerSelected(ids);
    propsRef.current.onSelectionChange?.(ids, { source });
  }, []);

  const setCollapsed = useCallback(
    (idx: number, collapse: boolean) => {
      const { model: m, collapsedList: list } = stateRef.current;
      const item = m.items[idx]!;
      const has = list.includes(item.id);
      if (has === collapse) return;
      const next = collapse ? [...list, item.id] : list.filter((id) => id !== item.id);
      if (propsRef.current.collapsedIds === undefined) setInnerCollapsed(next);
      propsRef.current.onCollapsedChange?.(next);
      const label = String(item.label ?? "");
      announce(collapse ? messages.groupCollapsed(label) : messages.groupExpanded(label));
    },
    [announce, messages],
  );

  const requestZoom = useCallback((id: string) => {
    if (propsRef.current.zoomLevel === undefined) setInnerZoom(id);
    if (stateRef.current.level.id !== id) propsRef.current.onZoomLevelChange?.(id);
  }, []);

  // ---- diagnostics (EVT-2) -----------------------------------------------------------------
  const allErrors = [...layout.errors, ...sizes.errors, ...zoomErrors];
  const errorsKey = JSON.stringify(allErrors);
  const lastErrors = useRef("[]");
  useEffect(() => {
    if (errorsKey === lastErrors.current) return;
    lastErrors.current = errorsKey;
    propsRef.current.onDataError?.(allErrors);
  }, [errorsKey]);
  const lastLayout = useRef<FlowLayout | null>(null);
  useEffect(() => {
    if (sameLayout(lastLayout.current, layout)) return;
    lastLayout.current = layout;
    propsRef.current.onLayoutChange?.(layout);
  }, [layout]);

  // ---- measuring ---------------------------------------------------------------------------
  useIsoLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[entries.length - 1]!.contentRect;
      setMeasured((m) =>
        m && m.width === r.width && m.height === r.height ? m : { width: r.width, height: r.height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Apply scroll requested by zoom changes or fitToView once the new level is rendered.
  useIsoLayoutEffect(() => {
    const p = pendingScroll.current;
    const el = scrollerRef.current;
    if (!p || !el || p.levelId !== level.id) return;
    pendingScroll.current = null;
    if (p.left !== undefined) el.scrollLeft = Math.max(0, p.left);
    if (p.top !== undefined) el.scrollTop = Math.max(0, p.top);
  });

  // Move DOM focus after keyboard navigation.
  useIsoLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    const i = model.index.get(id);
    const r = i === undefined ? -1 : rows.rowOf[i]!;
    const el = gridRef.current?.querySelector<HTMLElement>(`[role="row"][data-fg-row="${r}"]`);
    el?.focus({ preventScroll: true });
  });

  // ---- scrolling helpers -------------------------------------------------------------------
  const scrollToBox = useCallback(
    (r: number, bar: Box | null, align: "start" | "center" | "nearest", behavior?: ScrollBehavior) => {
      const el = scrollerRef.current;
      if (!el) return;
      const g = geoRef.current;
      const { model: m, rows: rs } = stateRef.current;
      const i = rs.order[r]!;
      const pinnedInset = stickyGroupHeaders && m.parent[i]! >= 0 ? g.rowH : 0;
      const top = r * g.rowH;
      let y = el.scrollTop;
      if (align === "start") y = top - pinnedInset;
      else if (align === "center") y = top - (g.bodyVisibleH - g.rowH) / 2;
      else if (top - pinnedInset < y) y = top - pinnedInset;
      else if (top + g.rowH > y + g.bodyVisibleH) y = top + g.rowH - g.bodyVisibleH;
      let x = el.scrollLeft;
      if (bar) {
        const margin = 2 * STUB;
        if (align === "start") x = bar.left - margin;
        else if (align === "center") x = bar.left + bar.width / 2 - g.tlVisibleW / 2;
        else if (bar.left - margin < x) x = bar.left - margin;
        else if (bar.left + bar.width + margin > x + g.tlVisibleW)
          x = Math.min(bar.left - margin, bar.left + bar.width + margin - g.tlVisibleW);
      }
      x = Math.max(0, x);
      y = Math.max(0, y);
      if (typeof el.scrollTo === "function") el.scrollTo({ left: x, top: y, behavior });
      else {
        el.scrollLeft = x;
        el.scrollTop = y;
      }
    },
    [stickyGroupHeaders],
  );

  const focusRow = useCallback(
    (r: number) => {
      const { model: m, rows: rs } = stateRef.current;
      const i = rs.order[r];
      if (i === undefined) return;
      const id = m.items[i]!.id;
      setActiveId(id);
      pendingFocus.current = id;
      scrollToBox(r, timelineOn ? geoRef.current.barBox(i, r) : null, "nearest");
    },
    [scrollToBox, timelineOn],
  );

  // ---- dependency validity (INT-12) --------------------------------------------------------
  const checkConnect = useCallback(
    (from: number, to: number, fresh = false): boolean => {
      const m = stateRef.current.model;
      if (from === to) return false;
      let v = validity.current;
      if (!v || v.from !== from || v.model !== m) {
        const r = revEdges();
        v = { from, model: m, upstream: reach([2 * from + 1], r.start, r.from), cache: new Map() };
        validity.current = v;
      }
      const cached = fresh ? undefined : v.cache.get(to);
      if (cached !== undefined) return cached;
      let ok = !pairs.has(from * m.items.length + to) && !v.upstream[2 * to];
      if (ok && propsRef.current.canConnect) {
        const p = propsRef.current;
        ok =
          p.canConnect?.({
            from: m.items[from]!,
            to: m.items[to]!,
            type: "finish-to-start",
            items: p.items,
            dependencies: p.dependencies,
          }) !== false;
      }
      v.cache.set(to, ok);
      return ok;
    },
    [revEdges, pairs],
  );

  const createDependency = useCallback(
    (from: number, to: number) => {
      const m = stateRef.current.model;
      const a = String(m.items[from]!.label ?? "");
      const b = String(m.items[to]!.label ?? "");
      // Re-ask the host at acceptance time: its policy may have changed during the drag.
      if (checkConnect(from, to, true)) {
        propsRef.current.onDependencyCreate?.({
          from: m.items[from]!.id,
          to: m.items[to]!.id,
          type: "finish-to-start",
        });
        announce(messages.dependencyCreated(a, b));
      } else announce(messages.dependencyRejected(a, b));
    },
    [checkConnect, announce, messages],
  );

  const canStartLink = (i: number) =>
    !propsRef.current.readOnly && propsRef.current.canConnectFrom?.(stateRef.current.model.items[i]!) !== false;

  // ---- hit testing -------------------------------------------------------------------------
  const hitTest = useCallback((target: EventTarget | null): Hit => {
    let el = target instanceof Element ? target : null;
    let handle: "left" | "right" | undefined;
    let toggle = false;
    let area: "grid" | "timeline" | "header" | "other" = "other";
    while (el && el !== scrollerRef.current) {
      const ds = (el as HTMLElement).dataset ?? {};
      if (ds.fgHandle) handle = ds.fgHandle as "left" | "right";
      else if (ds.fgToggle !== undefined) toggle = true;
      else if (ds.fgBar !== undefined) return { area: "timeline", bar: Number(ds.fgBar), handle };
      else if (ds.fgDep !== undefined) return { area: "timeline", dep: Number(ds.fgDep) };
      else if (ds.fgRow !== undefined) return { area: "grid", row: Number(ds.fgRow), toggle };
      else if (ds.fgArea) {
        area = ds.fgArea as typeof area;
        break;
      }
      el = el.parentElement;
    }
    return { area };
  }, []);

  const contentPoint = (clientX: number, clientY: number) => {
    const el = scrollerRef.current!;
    const rect = rectRef.current ?? el.getBoundingClientRect();
    const g = geoRef.current;
    return {
      x: clientX - rect.left + el.scrollLeft - g.gridW,
      y: clientY - rect.top + el.scrollTop - g.headerH,
    };
  };

  // ---- selection from pointer --------------------------------------------------------------
  const selectRow = (r: number, mods: { shift: boolean; ctrl: boolean }) => {
    const { model: m, rows: rs, selectedList: sel } = stateRef.current;
    const id = m.items[rs.order[r]!]!.id;
    const anchorIdx = anchorRef.current !== null ? m.index.get(anchorRef.current) : undefined;
    const anchorRow = anchorIdx !== undefined ? rs.rowOf[anchorIdx]! : -1;
    if (mods.shift && anchorRow >= 0) {
      const [a, b] = anchorRow < r ? [anchorRow, r] : [r, anchorRow];
      const range: ItemId[] = [];
      for (let k = a; k <= b; k++) range.push(m.items[rs.order[k]!]!.id);
      const has = new Set(sel);
      const next = mods.ctrl ? [...sel, ...range.filter((x) => !has.has(x))] : range;
      setSelection(next, "pointer");
      announce(messages.selectionCount(next.length));
      return;
    }
    anchorRef.current = id;
    if (mods.ctrl) setSelection(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id], "pointer");
    else setSelection([id], "pointer");
  };

  // ---- context menu ------------------------------------------------------------------------
  const fireContextMenu = (
    target: FlowContextMenuTarget<TData>,
    area: "grid" | "timeline",
    clientX: number,
    clientY: number,
    nativeEvent: MouseEvent | KeyboardEvent | TouchEvent,
  ): boolean => {
    const handler = propsRef.current.onContextMenu;
    if (!handler) return false;
    const ev: FlowContextMenuEvent<TData> = { target, area, clientX, clientY, nativeEvent };
    return handler(ev) === true;
  };

  const targetOf = (hit: Hit): FlowContextMenuTarget<TData> => {
    const { model: m, rows: rs } = stateRef.current;
    if ("bar" in hit) return { type: "item", item: m.items[rs.order[hit.bar]!]! };
    if ("row" in hit) return { type: "item", item: m.items[rs.order[hit.row]!]! };
    if ("dep" in hit) return { type: "dependency", dependency: m.deps[hit.dep]!.dep };
    return { type: "empty" };
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    const lp = longPress.current;
    if (lp.fired) {
      // The long-press timer already reported this gesture (INT-10).
      lp.fired = false;
      if (lp.handled) e.preventDefault();
      return;
    }
    if (lp.timer) {
      // The browser reported the long press first: cancel our timer and the pending tap.
      clearTimeout(lp.timer);
      lp.timer = 0;
      pressRef.current = null;
    }
    if (performance.now() - kbMenu.current.at < 1000) {
      // Already reported from the keyboard handler (A11Y-6, INT-10): never call the host twice.
      kbMenu.current.at = Number.NEGATIVE_INFINITY;
      if (kbMenu.current.handled) e.preventDefault();
      return;
    }
    const hit = hitTest(e.target);
    if (hit.area === "header" || hit.area === "other") return;
    const area = hit.area === "grid" ? "grid" : "timeline";
    if (fireContextMenu(targetOf(hit), area, e.clientX, e.clientY, e.nativeEvent)) e.preventDefault();
  };

  // ---- auto-scroll during drags (INT-15) ---------------------------------------------------
  const stopAutoScroll = () => {
    cancelAnimationFrame(autoScroll.current.raf);
    autoScroll.current.raf = 0;
    autoScroll.current.vx = 0;
    autoScroll.current.vy = 0;
  };
  const updateAutoScroll = (clientX: number, clientY: number, horizontal: boolean, onTick: () => void) => {
    const el = scrollerRef.current!;
    const rect = rectRef.current ?? el.getBoundingClientRect();
    const g = geoRef.current;
    const a = autoScroll.current;
    a.cx = clientX;
    a.cy = clientY;
    const speed = (d: number) => Math.ceil(((EDGE - Math.max(0, d)) / EDGE) * 16);
    const left = rect.left + g.gridW;
    const right = rect.left + g.gridW + g.tlVisibleW;
    const top = rect.top + g.headerH;
    const bottom = rect.top + g.headerH + g.bodyVisibleH;
    a.vx = !horizontal
      ? 0
      : clientX < left + EDGE
        ? -speed(clientX - left)
        : clientX > right - EDGE
          ? speed(right - clientX)
          : 0;
    a.vy = clientY < top + EDGE ? -speed(clientY - top) : clientY > bottom - EDGE ? speed(bottom - clientY) : 0;
    if ((a.vx || a.vy) && !a.raf) {
      const tick = () => {
        a.raf = 0;
        if (!a.vx && !a.vy) return;
        el.scrollLeft += a.vx;
        el.scrollTop += a.vy;
        try {
          onTick();
        } catch (err) {
          stopAutoScroll();
          throw err;
        }
        a.raf = requestAnimationFrame(tick);
      };
      a.raf = requestAnimationFrame(tick);
    }
  };

  // ---- link drag (INT-11 to INT-15) --------------------------------------------------------
  const linkTargetAt = (x: number, y: number, from: number): { target: number; valid: boolean } => {
    const rs = stateRef.current.rows;
    const g = geoRef.current;
    const r = Math.floor(y / g.rowH);
    if (r < 0 || r >= rs.order.length) return { target: -1, valid: false };
    const i = rs.order[r]!;
    if (i === from) return { target: -1, valid: false };
    const b = g.barBox(i, r);
    const pad = 14;
    if (x < b.left - pad || x > b.left + b.width + pad) return { target: -1, valid: false };
    return { target: i, valid: checkConnect(from, i) };
  };
  // Pointer moves are coalesced to one chart render per animation frame.
  const linkFrame = useRef<{ raf: number; x: number; y: number }>({ raf: 0, x: 0, y: 0 });
  const moveLink = (clientX: number, clientY: number) => {
    const f = linkFrame.current;
    f.x = clientX;
    f.y = clientY;
    if (f.raf) return;
    f.raf = requestAnimationFrame(() => {
      f.raf = 0;
      const d = linkRef.current;
      if (!d) return;
      const p = contentPoint(f.x, f.y);
      const t = linkTargetAt(p.x, p.y, d.from);
      if (Math.abs(p.x - d.x) < 1 && Math.abs(p.y - d.y) < 1 && t.target === d.target) return;
      setLinkDrag({ ...d, x: p.x, y: p.y, target: t.target, valid: t.valid });
    });
  };
  const capture = (pointerId: number) => {
    scrollerRef.current?.setPointerCapture?.(pointerId);
    captured.current = pointerId;
  };
  const releaseCapture = () => {
    const el = scrollerRef.current;
    const id = captured.current;
    captured.current = null;
    if (el && id !== null && el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
  };
  const cancelInteraction = useCallback(() => {
    cancelAnimationFrame(linkFrame.current.raf);
    linkFrame.current.raf = 0;
    stopAutoScroll();
    releaseCapture();
    clearTimeout(longPress.current.timer);
    longPress.current.timer = 0;
    pressRef.current = null;
    setLinkDrag(null);
    setKbLink(null);
    setReorderDrag(null);
    setPanning(false);
  }, []);

  // Escape cancels pointer drags even when the focus is outside the chart (INT-14).
  useEffect(() => {
    if (!linkDrag && !reorderDrag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelInteraction();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [linkDrag !== null, reorderDrag !== null, cancelInteraction]);

  // ---- reorder (INT-18) --------------------------------------------------------------------
  const reorderTargetAt = (y: number, dragIdx: number): ReorderDrag => {
    const { model: m, rows: rs } = stateRef.current;
    const g = geoRef.current;
    const n = rs.order.length;
    const b = Math.max(0, Math.min(n, Math.round(y / g.rowH)));
    const parentOf = (i: number) => m.parent[i]!;
    const at = (row: number) => (row >= 0 && row < n ? rs.order[row]! : -1);
    const below = at(b);
    const above = at(b - 1);
    let parent = -1;
    if (!m.isGroup[dragIdx]) {
      if (below >= 0 && parentOf(below) >= 0) parent = parentOf(below);
      else if (above >= 0 && parentOf(above) >= 0 && parentOf(dragIdx) === parentOf(above)) parent = parentOf(above);
      else if (above >= 0 && m.isGroup[above] && !stateRef.current.collapsed.has(m.items[above]!.id)) parent = above;
    }
    const siblings = (parent >= 0 ? m.children[parent]! : stateRef.current.topLevel).filter((i) => i !== dragIdx);
    let index = 0;
    for (const s of siblings) if (rs.rowOf[s]! >= 0 && rs.rowOf[s]! < b) index++;
    // Marker at the top of the sibling at `index`, or after the block of the last sibling.
    let marker: number;
    const next = siblings[index];
    if (next !== undefined && rs.rowOf[next]! >= 0) marker = rs.rowOf[next]!;
    else if (siblings.length > 0) {
      const last = siblings[siblings.length - 1]!;
      const kids = m.children[last]!;
      const tail = kids.length > 0 && rs.rowOf[kids[kids.length - 1]!]! >= 0 ? kids[kids.length - 1]! : last;
      marker = rs.rowOf[tail]! + 1;
    } else marker = parent >= 0 ? rs.rowOf[parent]! + 1 : n;
    const same = parent === parentOf(dragIdx) && index === m.siblingIndex[dragIdx];
    const change = same ? null : { parent, index };
    let valid = !same;
    const prev = reorderRef.current;
    if (change && prev?.change && prev.item === dragIdx && prev.change.parent === parent && prev.change.index === index)
      valid = prev.valid;
    else if (change && propsRef.current.canReorder) {
      valid = propsRef.current.canReorder(reorderChange(dragIdx, change)) !== false;
    }
    return { item: dragIdx, change, marker, valid };
  };
  const reorderChange = (idx: number, c: { parent: number; index: number }): ReorderChange<TData> => {
    const m = stateRef.current.model;
    return {
      item: m.items[idx]!,
      newParentId: c.parent >= 0 ? m.items[c.parent]!.id : null,
      newIndex: c.index,
    };
  };

  // ---- pointer handling --------------------------------------------------------------------
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = scrollerRef.current!;
    if (kbMode) setKbMode(false);
    longPress.current.fired = false;
    // A real right-click starts with a pointerdown; a keyboard menu gesture does not (INT-10).
    kbMenu.current.at = Number.NEGATIVE_INFINITY;
    if (e.button !== 0) return;
    const hit = hitTest(e.target);
    lastPressHit.current = hit;
    const touch = e.pointerType === "touch";
    rectRef.current = el.getBoundingClientRect();
    const rs = stateRef.current.rows;
    if ("handle" in hit && hit.handle && "bar" in hit) {
      const from = rs.order[hit.bar]!;
      if (!canStartLink(from)) return;
      e.preventDefault();
      capture(e.pointerId);
      pressRef.current = { kind: "link", pointerId: e.pointerId };
      validity.current = null;
      const p = contentPoint(e.clientX, e.clientY);
      setLinkDrag({ from, x: p.x, y: p.y, target: -1, valid: false });
      return;
    }
    if (hit.area !== "grid" && hit.area !== "timeline") return;
    pressRef.current = {
      kind: hit.area,
      pointerId: e.pointerId,
      touch,
      x0: e.clientX,
      y0: e.clientY,
      left0: el.scrollLeft,
      top0: el.scrollTop,
      hit,
      moved: false,
      mods: { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey },
    };
    if (touch) {
      clearTimeout(longPress.current.timer);
      const { clientX, clientY } = e;
      const native = e.nativeEvent;
      longPress.current.timer = setTimeout(() => {
        const lp = longPress.current;
        lp.timer = 0;
        const p = pressRef.current;
        if (!p || p.kind === "link" || p.kind === "reorder" || p.kind === "splitter" || p.moved) return;
        lp.fired = true;
        pressRef.current = null;
        lp.handled = fireContextMenu(targetOf(p.hit), p.kind, clientX, clientY, native);
      }, LONG_PRESS_MS);
      return;
    }
    capture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pressRef.current;
    if (!p) {
      if (e.pointerType !== "touch") updateHover(e.target);
      return;
    }
    if (p.pointerId !== e.pointerId) return;
    const el = scrollerRef.current!;
    if (p.kind === "link") {
      moveLink(e.clientX, e.clientY);
      updateAutoScroll(e.clientX, e.clientY, true, () => moveLink(autoScroll.current.cx, autoScroll.current.cy));
      return;
    }
    if (p.kind === "reorder") {
      const update = (cx: number, cy: number) => {
        const d = reorderRef.current;
        if (d) setReorderDrag(reorderTargetAt(contentPoint(cx, cy).y, d.item));
      };
      update(e.clientX, e.clientY);
      updateAutoScroll(e.clientX, e.clientY, false, () => update(autoScroll.current.cx, autoScroll.current.cy));
      return;
    }
    if (p.kind === "splitter") {
      setGridOverride(Math.max(0, Math.min(2000, p.w0 + e.clientX - p.x0)));
      return;
    }
    const dx = e.clientX - p.x0;
    const dy = e.clientY - p.y0;
    if (!p.moved && Math.hypot(dx, dy) > (p.touch ? 10 : DRAG_THRESHOLD)) {
      p.moved = true;
      clearTimeout(longPress.current.timer);
      if (p.touch) return; // native scrolling handles touch panning
      if (p.kind === "timeline") setPanning(true);
      else if (
        p.kind === "grid" &&
        "row" in p.hit &&
        !p.hit.toggle &&
        !propsRef.current.readOnly &&
        propsRef.current.onReorder
      ) {
        const idx = stateRef.current.rows.order[p.hit.row]!;
        pressRef.current = { kind: "reorder", pointerId: p.pointerId };
        setReorderDrag(reorderTargetAt(contentPoint(e.clientX, e.clientY).y, idx));
        return;
      }
    }
    if (p.moved && p.kind === "timeline" && !p.touch) {
      el.scrollLeft = p.left0 - dx;
      el.scrollTop = p.top0 - dy;
    }
  };

  const endPress = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const p = pressRef.current;
    clearTimeout(longPress.current.timer);
    if (!p || p.pointerId !== e.pointerId) return;
    pressRef.current = null;
    stopAutoScroll();
    releaseCapture();
    if (p.kind === "link") {
      cancelAnimationFrame(linkFrame.current.raf);
      linkFrame.current.raf = 0;
      let d = linkRef.current;
      if (d && !cancelled) {
        const pt = contentPoint(e.clientX, e.clientY);
        d = { ...d, ...linkTargetAt(pt.x, pt.y, d.from) };
      }
      setLinkDrag(null);
      if (d && !cancelled && d.target >= 0) createDependency(d.from, d.target);
      return;
    }
    if (p.kind === "reorder") {
      const d = reorderRef.current;
      setReorderDrag(null);
      if (d && !cancelled && d.change && d.valid) propsRef.current.onReorder?.(reorderChange(d.item, d.change));
      return;
    }
    if (p.kind === "splitter") return;
    setPanning(false);
    if (cancelled || p.moved || longPress.current.fired) return;
    // A completed click (INT-1, INT-6, INT-7).
    const hit = p.hit;
    if ("row" in hit) {
      if (hit.toggle) {
        const idx = stateRef.current.rows.order[hit.row]!;
        setCollapsed(idx, !stateRef.current.collapsed.has(stateRef.current.model.items[idx]!.id));
        return;
      }
      selectRow(hit.row, p.mods);
      const idx = stateRef.current.rows.order[hit.row]!;
      setActiveId(stateRef.current.model.items[idx]!.id);
    } else if ("bar" in hit) {
      selectRow(hit.bar, p.mods);
      setActiveId(stateRef.current.model.items[stateRef.current.rows.order[hit.bar]!]!.id);
    } else if ("dep" in hit) {
      // clicking a connector neither selects nor clears
    } else if (hit.area === "grid" || hit.area === "timeline") {
      setSelection([], "pointer");
    }
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    // D-22: a pointer press only takes DOM focus when the chart already has it.
    const root = rootRef.current;
    if (!root || root.contains(document.activeElement)) return;
    const hit = hitTest(e.target);
    if ("row" in hit) e.preventDefault();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    // Pointer capture retargets the click to the scroller, so use the pressed element.
    const hit = e.target === scrollerRef.current && lastPressHit.current ? lastPressHit.current : hitTest(e.target);
    const { model: m, rows: rs } = stateRef.current;
    const r = "bar" in hit ? hit.bar : "row" in hit && !hit.toggle ? hit.row : -1;
    if (r >= 0) propsRef.current.onItemDoubleClick?.(m.items[rs.order[r]!]!);
  };

  const updateHover = (target: EventTarget | null) => {
    const hit = hitTest(target);
    const r = "bar" in hit ? hit.bar : "row" in hit ? hit.row : -1;
    const { model: m, rows: rs } = stateRef.current;
    const id = r >= 0 && r < rs.order.length ? m.items[rs.order[r]!]!.id : null;
    setHoverId((h) => (h === id ? h : id));
  };

  // ---- wheel zoom (INT-21) -----------------------------------------------------------------
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const rect = el.getBoundingClientRect();
      const g = geoRef.current;
      const px = e.clientX - rect.left - g.gridW;
      if (px < 0) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      wheelAcc.current += delta;
      if (Math.abs(wheelAcc.current) < 50) return;
      const dir = wheelAcc.current > 0 ? 1 : -1;
      wheelAcc.current = 0;
      const { levels: ls, requested: req, model: m } = stateRef.current;
      const next = Math.max(0, Math.min(ls.length - 1, req + dir));
      if (next === req) return;
      const lv = ls[next]!;
      const base = resolveLayoutOptions(propsRef.current).baseUnit;
      const u = (el.scrollLeft + px - g.colW) / g.ppu;
      const ppu2 = pxPerUnit(lv, base);
      const eff = effectiveZoom(ls, next, m.maxUnits, base);
      if (eff.index !== next) return;
      pendingScroll.current = { levelId: lv.id, left: lv.minColumnWidth + u * ppu2 - px };
      requestZoom(lv.id);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [requestZoom]);

  // ---- keyboard (A11Y-2 and friends) -------------------------------------------------------
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const hit = hitTest(e.target);
    if (!("row" in hit)) return;
    // Keys typed into interactive host content inside a cell belong to that content.
    const t = e.target as HTMLElement;
    if (t.getAttribute("role") !== "row" && t.closest(INTERACTIVE)) return;
    if (!kbMode) setKbMode(true);
    // One-shot actions ignore key repeat; navigation and Alt+arrow reordering repeat on purpose.
    if (e.repeat && !/^(Arrow|Page|Home|End)/.test(e.key)) {
      e.preventDefault();
      return;
    }
    const { model: m, rows: rs, selectedList: sel, collapsed: col } = stateRef.current;
    const p = propsRef.current;
    const n = rs.order.length;
    if (n === 0) return;
    const cur = Math.min(Math.max(effectiveActiveRow, 0), n - 1);
    const idx = rs.order[cur]!;
    const item = m.items[idx]!;
    const mod = e.ctrlKey || e.metaKey;
    const page = Math.max(1, Math.floor(geoRef.current.bodyVisibleH / rowH) - 1);
    const editable = !p.readOnly;
    const move = (to: number) => {
      const t = Math.max(0, Math.min(n - 1, to));
      focusRow(t);
      if (kbLink) {
        const ti = rs.order[t]!;
        const valid = ti !== kbLink.from && checkConnect(kbLink.from, ti);
        setKbLink({ from: kbLink.from, target: ti === kbLink.from ? -1 : ti, valid });
        if (ti !== kbLink.from) announce(messages.linkCandidate(String(m.items[ti]!.label ?? ""), valid));
      }
      return t;
    };
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        const dir = e.key === "ArrowDown" ? 1 : -1;
        if (e.altKey) {
          if (editable && p.onReorder && p.keyboardShortcuts?.reorder !== false && !kbLink) keyboardReorder(idx, dir);
          break;
        }
        const t = move(cur + dir);
        if (e.shiftKey && !kbLink) {
          const anchorIdx = anchorRef.current !== null ? m.index.get(anchorRef.current) : undefined;
          let a = anchorIdx !== undefined ? rs.rowOf[anchorIdx]! : -1;
          if (a < 0) {
            a = cur;
            anchorRef.current = item.id;
          }
          const [lo, hi] = a < t ? [a, t] : [t, a];
          const range: ItemId[] = [];
          for (let k = lo; k <= hi; k++) range.push(m.items[rs.order[k]!]!.id);
          setSelection(range, "keyboard");
          announce(messages.selectionCount(range.length));
        }
        break;
      }
      case "Home":
        move(0);
        break;
      case "End":
        move(n - 1);
        break;
      case "PageDown":
        move(cur + page);
        break;
      case "PageUp":
        move(cur - page);
        break;
      case "ArrowRight":
        if (m.isGroup[idx]) {
          if (col.has(item.id)) setCollapsed(idx, false);
          else if (m.children[idx]!.length > 0) move(cur + 1);
        }
        break;
      case "ArrowLeft":
        if (m.isGroup[idx] && !col.has(item.id)) setCollapsed(idx, true);
        else if (m.parent[idx]! >= 0) move(rs.rowOf[m.parent[idx]!]!);
        break;
      case " ":
      case "Spacebar":
        anchorRef.current = item.id;
        if (mod) setSelection(sel.includes(item.id) ? sel.filter((x) => x !== item.id) : [...sel, item.id], "keyboard");
        else setSelection([item.id], "keyboard");
        break;
      case "a":
      case "A":
        if (!mod) {
          handled = false;
          break;
        }
        setSelection(
          Array.from(rs.order, (i) => m.items[i]!.id),
          "keyboard",
        );
        announce(messages.selectionCount(n));
        break;
      case "Enter":
        if (kbLink) {
          const { from, target } = kbLink;
          setKbLink(null);
          if (target >= 0) createDependency(from, target);
        } else p.onItemActivate?.(item);
        break;
      case "Escape":
        if (linkDrag || reorderDrag) cancelInteraction();
        else if (kbLink) setKbLink(null);
        else if (sel.length > 0) setSelection([], "keyboard");
        else handled = false;
        break;
      case "Delete":
      case "Backspace":
        if (editable && p.onDeleteRequest) p.onDeleteRequest(sel.length > 0 ? [...sel] : [item.id]);
        else handled = false;
        break;
      case "ContextMenu":
      case "F10":
        if (e.key === "F10" && !e.shiftKey) {
          handled = false;
          break;
        }
        openKeyboardMenu(cur, idx, e.nativeEvent);
        break;
      case "d":
      case "D":
        if (mod || e.altKey || !editable || p.keyboardShortcuts?.beginDependency === false || !canStartLink(idx)) {
          handled = false;
          break;
        }
        setKbLink({ from: idx, target: -1, valid: false });
        announce(messages.linkingStarted(String(item.label ?? "")));
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const keyboardReorder = (idx: number, dir: number) => {
    const m = stateRef.current.model;
    const parent = m.parent[idx]!;
    const count = parent >= 0 ? m.children[parent]!.length : stateRef.current.topLevel.length;
    const index = m.siblingIndex[idx]! + dir;
    if (index < 0 || index >= count) return;
    const change = reorderChange(idx, { parent, index });
    if (propsRef.current.canReorder?.(change) === false) return;
    propsRef.current.onReorder?.(change);
    pendingFocus.current = m.items[idx]!.id;
    announce(messages.rowMoved(String(m.items[idx]!.label ?? ""), index + 1));
  };

  const openKeyboardMenu = (r: number, idx: number, native: KeyboardEvent) => {
    const el = scrollerRef.current!;
    const rect = el.getBoundingClientRect();
    const g = geoRef.current;
    const b = timelineOn ? g.barBox(idx, r) : null;
    const yRow = rect.top + g.headerH + r * g.rowH - el.scrollTop + g.rowH / 2;
    let x = rect.left + 16;
    let area: "grid" | "timeline" = "grid";
    if (b && b.left + b.width > el.scrollLeft && b.left < el.scrollLeft + g.tlVisibleW) {
      x = rect.left + g.gridW + Math.max(b.left, el.scrollLeft) - el.scrollLeft + 8;
      area = "timeline";
    }
    const handled = fireContextMenu(
      { type: "item", item: stateRef.current.model.items[idx]! },
      area,
      Math.round(x),
      Math.round(yRow),
      native,
    );
    kbMenu.current = { at: performance.now(), handled };
  };

  // ---- imperative API (13.3) ---------------------------------------------------------------
  const flashTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const fitToView = useCallback(
    (options?: { ids?: readonly ItemId[] }) => {
      const { model: m, levels: ls, rows: rs } = stateRef.current;
      const g = geoRef.current;
      const base = resolveLayoutOptions(propsRef.current).baseUnit;
      let lo = 0;
      let hi = m.maxUnits;
      let firstRow = -1;
      if (options?.ids) {
        lo = Number.POSITIVE_INFINITY;
        hi = Number.NEGATIVE_INFINITY;
        for (const id of options.ids) {
          const i = m.index.get(id);
          if (i === undefined) continue;
          lo = Math.min(lo, m.start[i]!);
          hi = Math.max(hi, m.end[i]!);
          const r = rs.rowOf[i]!;
          if (r >= 0 && (firstRow < 0 || r < firstRow)) firstRow = r;
        }
        if (!Number.isFinite(lo)) return;
      }
      const ranked = ls.map((l, k) => ({ k, ppu: pxPerUnit(l, base), colW: l.minColumnWidth }));
      ranked.sort((a, b) => b.ppu - a.ppu);
      const fits = (c: (typeof ranked)[number]) =>
        options?.ids
          ? (hi - lo) * c.ppu + 2 * c.colW <= g.tlVisibleW
          : contentColumns(m.maxUnits, c.ppu, c.colW) * c.colW <= g.tlVisibleW;
      const pick = ranked.find(fits) ?? ranked[ranked.length - 1]!;
      const lv = ls[pick.k]!;
      const left = options?.ids ? lo * pick.ppu : 0;
      pendingScroll.current = {
        levelId: lv.id,
        left,
        top: firstRow >= 0 ? firstRow * g.rowH - (stickyGroupHeaders ? g.rowH : 0) : undefined,
      };
      if (lv.id === stateRef.current.level.id) {
        const el = scrollerRef.current;
        if (el) {
          el.scrollLeft = Math.max(0, left);
          if (pendingScroll.current.top !== undefined) el.scrollTop = Math.max(0, pendingScroll.current.top);
        }
        pendingScroll.current = null;
      } else requestZoom(lv.id);
    },
    [requestZoom, stickyGroupHeaders],
  );

  useImperativeHandle(
    ref,
    (): FlowGanttHandle => ({
      scrollToItem(id, options) {
        const { model: m, rows: rs } = stateRef.current;
        const i = m.index.get(id);
        if (i === undefined || rs.rowOf[i]! < 0) return;
        const r = rs.rowOf[i]!;
        scrollToBox(r, timelineOn ? geoRef.current.barBox(i, r) : null, options?.align ?? "nearest", options?.behavior);
      },
      scrollTo(p) {
        const el = scrollerRef.current;
        if (!el) return;
        if (p.left !== undefined) el.scrollLeft = p.left;
        if (p.top !== undefined) el.scrollTop = p.top;
      },
      getScroll() {
        const el = scrollerRef.current;
        return { left: el?.scrollLeft ?? 0, top: el?.scrollTop ?? 0 };
      },
      getItemBox(id) {
        const { model: m, rows: rs } = stateRef.current;
        const i = m.index.get(id);
        if (i === undefined || rs.rowOf[i]! < 0) return null;
        const r = rs.rowOf[i]!;
        return { bar: geoRef.current.barBox(i, r), row: geoRef.current.rowBox(r) };
      },
      focusItem(id) {
        const { model: m, rows: rs } = stateRef.current;
        const i = m.index.get(id);
        if (i === undefined || rs.rowOf[i]! < 0) return;
        setKbMode(true);
        focusRow(rs.rowOf[i]!);
      },
      beginDependency(fromId) {
        const { model: m, rows: rs } = stateRef.current;
        const i = m.index.get(fromId);
        if (i === undefined || rs.rowOf[i]! < 0 || !canStartLink(i)) return;
        setKbMode(true);
        focusRow(rs.rowOf[i]!);
        setKbLink({ from: i, target: -1, valid: false });
        announce(messages.linkingStarted(String(m.items[i]!.label ?? "")));
      },
      cancelInteraction,
      fitToView,
      flashItem(id) {
        if (prefersReducedMotion()) return;
        const { model: m, rows: rs } = stateRef.current;
        const i = m.index.get(id);
        if (i === undefined || rs.rowOf[i]! < 0) return;
        const r = rs.rowOf[i]!;
        scrollToBox(r, timelineOn ? geoRef.current.barBox(i, r) : null, "nearest");
        clearTimeout(flashTimer.current);
        setFlash((f) => ({ id, n: (f?.n ?? 0) + 1 }));
        flashTimer.current = setTimeout(() => setFlash(null), 1000);
      },
    }),
  );

  const didFit = useRef(false);
  useEffect(() => {
    if (!props.fitOnLoad || didFit.current || (typeof ResizeObserver !== "undefined" && !measured)) return;
    didFit.current = true;
    fitToView();
  });

  // A focused row that disappears (collapsed or removed by the host) hands focus to a visible
  // ancestor or the first row, so keyboard users are never stranded.
  useIsoLayoutEffect(() => {
    if (!hasFocus || activeId === null || activeRow >= 0 || rowCount === 0) return;
    const root = rootRef.current;
    if (
      root &&
      document.activeElement &&
      root.contains(document.activeElement) &&
      document.activeElement !== document.body
    )
      return;
    const prevIdx = model.index.get(activeId);
    const parent = prevIdx !== undefined ? model.parent[prevIdx]! : -1;
    const r = parent >= 0 && rows.rowOf[parent]! >= 0 ? rows.rowOf[parent]! : 0;
    const id = model.items[rows.order[r]!]!.id;
    setActiveId(id);
    pendingFocus.current = id;
  });

  // Leaving read-only mode or losing items ends keyboard linking.
  useEffect(() => {
    if (readOnly) cancelInteraction();
  }, [readOnly, cancelInteraction]);

  useEffect(
    () => () => {
      stopAutoScroll();
      clearTimeout(longPress.current.timer);
    },
    [],
  );

  // ---- render ------------------------------------------------------------------------------
  const resolvedColumns = useMemo((): ResolvedColumn<TData>[] => {
    const cols = (
      props.columns && props.columns.length > 0 ? props.columns : DEFAULT_COLUMNS
    ) as readonly FlowColumn<TData>[];
    let tree = cols.findIndex((c) => c.tree);
    if (tree < 0) tree = 0;
    return cols.map((col, k) => ({
      col,
      tree: k === tree,
      style:
        typeof col.width === "number" && Number.isFinite(col.width)
          ? { width: Math.max(0, col.width), flex: "none" }
          : { flex: "1 1 0", minWidth: 0 },
    }));
  }, [props.columns]);

  const chainSource =
    linkDrag || reorderDrag ? -1 : (model.index.get(hoverId ?? (hasFocus ? activeId : null) ?? "\u0000") ?? -1);
  const highlightSet = useMemo(
    () => (props.highlightedIds && props.highlightedIds.length > 0 ? new Set(props.highlightedIds) : null),
    [props.highlightedIds],
  );
  const highlight = useMemo(
    () => computeHighlight(model, revEdges, chainSource, chainHighlight, highlightSet),
    [model, revEdges, chainSource, chainHighlight, highlightSet],
  );
  const pathItems = useMemo(() => {
    const s = new Uint8Array(model.items.length);
    if (highlightLongestPath) for (const i of model.longestPath) s[i] = 1;
    return s;
  }, [model, highlightLongestPath]);

  // Visible window.
  const r0 = Math.max(0, Math.floor(scroll.top / rowH) - OVERSCAN);
  const r1 = Math.min(rowCount - 1, Math.ceil((scroll.top + bodyVisibleH) / rowH) + OVERSCAN);
  const xMin = scroll.left - tlVisibleW;
  const xMax = scroll.left + 2 * tlVisibleW;
  const yMin = r0 * rowH;
  const yMax = (r1 + 1) * rowH;

  const statusOf = (item: FlowItem<TData>): ItemStatus | undefined => {
    const s = props.getItemStatus?.(item);
    return s === "error" || s === "warning" || s === "success" || s === "running" || s === "pending" || s === "skipped"
      ? s
      : undefined;
  };
  const variantOf = (i: number): string => {
    const item = model.items[i]!;
    if (props.getBarVariant) {
      const predecessors = model.inDeps[i]!.map((d) => model.items[model.deps[d]!.from]!);
      return String(props.getBarVariant(item, { predecessors }));
    }
    return model.isGroup[i] ? "group" : model.inDeps[i]!.length > 0 ? "dependent" : "default";
  };
  const labelOf = (item: FlowItem<TData>) =>
    props.getAccessibleLabel ? String(props.getAccessibleLabel(item)) : String(item.label ?? "");
  const describe = (i: number, status: ItemStatus | undefined, variant: string): string => {
    const item = model.items[i]!;
    const preds = model.inDeps[i]!.map((d) => labelOf(model.items[model.deps[d]!.from]!));
    const succs = model.outDeps[i]!.map((d) => labelOf(model.items[model.deps[d]!.to]!));
    const parts = [
      messages.startsAfter(preds.length > 0 ? preds : [messages.none]),
      messages.followedBy(succs.length > 0 ? succs : [messages.none]),
    ];
    if (status) parts.push(props.getStatusText ? String(props.getStatusText(item)) : messages.status[status]);
    const v = messages.variant(variant);
    if (v) parts.push(v);
    if (pathItems[i]) parts.push(messages.longestPath);
    return parts.join(" ");
  };

  const topCount = topLevel.length;

  const gridRowFor = (r: number, pinned: boolean, top: number): ReactNode => {
    const i = rows.order[r]!;
    const item = model.items[i]!;
    const p = model.parent[i]!;
    const isGroup = model.isGroup[i] === 1;
    const status = statusOf(item);
    const variant = pinned ? "" : variantOf(i);
    return (
      <GridRow<TData>
        key={pinned ? `pinned:${item.id}` : item.id}
        item={item}
        row={r}
        top={top}
        height={rowH}
        level={p >= 0 ? 2 : 1}
        setsize={p >= 0 ? model.children[p]!.length : topCount}
        posinset={model.siblingIndex[i]! + 1}
        isGroup={isGroup}
        collapsed={collapsed.has(item.id)}
        selected={selected.has(item.id)}
        status={status}
        alt={model.siblingIndex[i]! % 2 === 0}
        lastChild={p >= 0 && model.children[p]![model.children[p]!.length - 1] === i}
        active={!pinned && r === effectiveActiveRow}
        dimmed={highlight !== null && !highlight.items[i]}
        label={labelOf(item)}
        description={pinned ? "" : describe(i, status, variant)}
        descId={pinned ? undefined : `${uid}-d${r}`}
        columns={resolvedColumns}
        pinned={pinned}
      />
    );
  };

  const gridRows: ReactNode[] = [];
  for (let r = r0; r <= r1; r++) gridRows.push(gridRowFor(r, false, r * rowH));
  if (effectiveActiveRow >= 0 && (effectiveActiveRow < r0 || effectiveActiveRow > r1)) {
    gridRows.push(gridRowFor(effectiveActiveRow, false, effectiveActiveRow * rowH));
  }

  // Sticky group header (X-4).
  let pinnedRow: ReactNode = null;
  if (stickyGroupHeaders && rowCount > 0 && scroll.top > 0) {
    const rTop = Math.min(rowCount - 1, Math.floor(scroll.top / rowH));
    const i = rows.order[rTop]!;
    const g = model.parent[i]! >= 0 ? model.parent[i]! : model.isGroup[i] ? i : -1;
    if (g >= 0 && rows.rowOf[g]! * rowH < scroll.top) {
      const kids = model.children[g]!;
      const lastRow = kids.length > 0 ? rows.rowOf[kids[kids.length - 1]!]! : -1;
      if (lastRow >= 0) {
        const top = Math.min(scroll.top, (lastRow + 1) * rowH - rowH);
        pinnedRow = gridRowFor(rows.rowOf[g]!, true, top);
      }
    }
  }

  // Timeline content.
  const timelineRows: ReactNode[] = [];
  const bars: ReactNode[] = [];
  const visibleItems: ItemBoxes<TData>[] = [];
  const dropFor = (i: number): "valid" | "invalid" | undefined => {
    if (linkDrag && linkDrag.target === i) return linkDrag.valid ? "valid" : "invalid";
    if (kbLink && i === kbLink.target) return kbLink.valid ? "valid" : "invalid";
    return undefined;
  };
  for (let r = r0; r <= r1 && timelineOn; r++) {
    const i = rows.order[r]!;
    const item = model.items[i]!;
    const isGroup = model.isGroup[i] === 1;
    const status = statusOf(item);
    const sel = selected.has(item.id);
    timelineRows.push(
      <div
        key={item.id}
        className="fg-trow"
        data-kind={isGroup ? "group" : "leaf"}
        data-selected={sel ? "true" : "false"}
        data-status={status}
        data-focused={r === effectiveActiveRow && hasFocus ? "" : undefined}
        style={{ top: r * rowH, height: rowH }}
      />,
    );
    const box = barBox(i, r);
    visibleItems.push({ item, bar: box, row: rowBox(r) });
    if (box.left + box.width < xMin || box.left > xMax) continue;
    const showHandles =
      !readOnly &&
      (sel || hoverId === item.id || (linkDrag !== null && linkDrag.from === i)) &&
      props.canConnectFrom?.(item) !== false;
    bars.push(
      <Bar<TData>
        key={item.id}
        item={item}
        row={r}
        box={box}
        isGroup={isGroup}
        level={model.parent[i]! >= 0 ? 2 : 1}
        collapsed={collapsed.has(item.id)}
        variant={variantOf(i)}
        selected={sel}
        status={status}
        dimmed={highlight !== null && !highlight.items[i]}
        onPath={pathItems[i] === 1}
        handles={showHandles}
        drop={dropFor(i)}
        flash={flash && flash.id === item.id ? flash.n : 0}
        renderBar={props.renderBar}
      />,
    );
  }

  // Connectors (REN-20 to REN-26).
  const links: ReactNode[] = [];
  const endInset = linkEndMarker === "arrow" ? 8 : DOT_RADIUS;
  for (let d = 0; d < model.deps.length && timelineOn; d++) {
    const md = model.deps[d]!;
    const rf = rows.rowOf[md.from]!;
    const rt = rows.rowOf[md.to]!;
    if (rf < 0 || rt < 0) continue;
    const sb = barBox(md.from, rf);
    const tb = barBox(md.to, rt);
    const sx = sb.left + sb.width;
    const sy = rf * rowH + rowH / 2;
    const tx = tb.left;
    const ty = rt * rowH + rowH / 2;
    if (Math.max(sx + STUB, tx) < xMin || Math.min(sx, tx - STUB) > xMax) continue;
    if (Math.max(sy, ty) < yMin || Math.min(sy, ty) > yMax) continue;
    const pts = routeConnector(sx, sy, tx, ty, rf * rowH, rowH, endInset);
    const dPath = pathData(pts);
    const isSel = selected.has(model.items[md.from]!.id) || selected.has(model.items[md.to]!.id);
    links.push(
      <g
        key={md.dep.id}
        className="fg-link"
        data-fg-dep={d}
        data-invalid={md.ignored ? "" : undefined}
        data-selected={isSel ? "" : undefined}
        data-dimmed={highlight !== null && !highlight.deps[d] ? "" : undefined}
        data-path={highlightLongestPath && model.pathDeps.has(d) ? "" : undefined}
      >
        <path className="fg-link-hit" d={dPath} />
        <path className="fg-link-line" d={dPath} />
        {linkEndMarker === "arrow" ? (
          <path className="fg-link-end" d={`M${tx - 8} ${ty - 4.5} L${tx} ${ty} L${tx - 8} ${ty + 4.5} Z`} />
        ) : (
          <circle className="fg-link-end" cx={tx - DOT_RADIUS} cy={ty} r={DOT_RADIUS} />
        )}
      </g>,
    );
  }

  // Layers (LAYER-1 to LAYER-3).
  const layerCtx: LayerContext<TData> = {
    visibleWindow: { left: scroll.left, top: scroll.top, width: tlVisibleW, height: bodyVisibleH },
    visibleItems,
    getItemBox: (id) => {
      const i = model.index.get(id);
      if (i === undefined || rows.rowOf[i]! < 0 || !timelineOn) return null;
      return { bar: barBox(i, rows.rowOf[i]!), row: rowBox(rows.rowOf[i]!) };
    },
    getChildrenBoxes: (groupId) => {
      const g = model.index.get(groupId);
      if (g === undefined || !timelineOn) return [];
      const out: ItemBoxes<TData>[] = [];
      for (const c of model.children[g]!) {
        const r = rows.rowOf[c]!;
        if (r >= 0) out.push({ item: model.items[c]!, bar: barBox(c, r), row: rowBox(r) });
      }
      return out;
    },
  };
  const frameGroups = useMemo(() => {
    const out: { id: string; first: number; last: number }[] = [];
    for (let i = 0; i < model.items.length; i++) {
      if (!model.isGroup[i] || rows.rowOf[i]! < 0) continue;
      const kids = model.children[i]!;
      if (kids.length === 0 || rows.rowOf[kids[0]!]! < 0) continue;
      out.push({ id: model.items[i]!.id, first: rows.rowOf[i]!, last: rows.rowOf[kids[kids.length - 1]!]! });
    }
    return out;
  }, [model, rows]);
  const layerNodes = (z: "below-rows" | "below-bars" | "above-bars") => {
    if (!timelineOn) return null;
    const out: ReactNode[] = [];
    if (z === "below-bars" && groupFrames) {
      out.push(
        <div key="fg-group-frames" className="fg-layer">
          {renderGroupFrames(layerCtx, frameGroups, rowH)}
        </div>,
      );
    }
    for (const layer of props.layers ?? []) {
      if (layer.zIndex !== z) continue;
      out.push(
        <div key={layer.id} className="fg-layer" data-layer={layer.id}>
          {layer.render(layerCtx)}
        </div>,
      );
    }
    return out;
  };

  // Drag previews (INT-11, A11Y-9, X-7).
  let preview: ReactNode = null;
  const linkFrom = linkDrag ? linkDrag.from : kbLink ? kbLink.from : -1;
  const linkTo = linkDrag ? linkDrag.target : kbLink ? kbLink.target : -1;
  const linkValid = linkDrag ? linkDrag.valid : kbLink ? kbLink.valid : false;
  const ghostModel = useMemo(() => {
    if (!previewDependencyLayout || linkFrom < 0 || linkTo < 0 || !linkValid) return null;
    const extra: FlowDependency = {
      id: `${uid}-preview`,
      from: model.items[linkFrom]!.id,
      to: model.items[linkTo]!.id,
      type: "finish-to-start",
    };
    return buildModel(items, [...dependencies, extra], layoutOpts);
  }, [previewDependencyLayout, linkFrom, linkTo, linkValid, items, dependencies, layoutOpts, model, uid]);
  if (timelineOn && linkFrom >= 0 && rows.rowOf[linkFrom]! >= 0) {
    const rf = rows.rowOf[linkFrom]!;
    const sb = barBox(linkFrom, rf);
    const sx = sb.left + sb.width;
    const sy = rf * rowH + rowH / 2;
    let tx = sx;
    let ty = sy;
    if (linkDrag) {
      tx = linkDrag.x;
      ty = linkDrag.y;
    } else if (linkTo >= 0 && rows.rowOf[linkTo]! >= 0) {
      tx = barBox(linkTo, rows.rowOf[linkTo]!).left;
      ty = rows.rowOf[linkTo]! * rowH + rowH / 2;
    }
    const ghosts: ReactNode[] = [];
    if (ghostModel) {
      for (let r = r0; r <= r1; r++) {
        const i = rows.order[r]!;
        const j = ghostModel.index.get(model.items[i]!.id);
        if (j === undefined) continue;
        const moved = ghostModel.start[j] !== model.start[i] || ghostModel.end[j] !== model.end[i];
        if (!moved && i !== linkTo) continue;
        const left = colW + ghostModel.start[j]! * ppu;
        const width = Math.max(MIN_BAR_WIDTH, (ghostModel.end[j]! - ghostModel.start[j]!) * ppu);
        ghosts.push(
          <div
            key={model.items[i]!.id}
            className="fg-ghost"
            data-kind={model.isGroup[i] ? "group" : "leaf"}
            data-ghost-row={r}
            style={{ left, width, top: r * rowH + Math.floor((rowH - barH) / 2), height: barH }}
          />,
        );
      }
    }
    preview = (
      <>
        {ghosts}
        {tx !== sx || ty !== sy ? (
          <svg className="fg-preview" width={contentW} height={bodyH} aria-hidden="true">
            <path
              className="fg-preview-line"
              data-valid={linkTo >= 0 ? (linkValid ? "true" : "false") : undefined}
              d={`M${sx} ${sy} L${sx + STUB} ${sy} L${sx + STUB} ${ty} L${tx} ${ty}`}
            />
          </svg>
        ) : null}
      </>
    );
  }

  let reorderMarker: ReactNode = null;
  if (reorderDrag) {
    reorderMarker = (
      <div
        className="fg-reorder-marker"
        data-valid={reorderDrag.valid ? "true" : "false"}
        style={{ top: reorderDrag.marker * rowH - 1 }}
      />
    );
  }

  // Time scale (ZOOM-5).
  const scale: ReactNode[] = [];
  if (showTimeScale && timelineOn) {
    const fmt = props.formatScaleLabel ?? defaultScaleLabel;
    const unitMs = layoutOpts.baseUnit === "hour" ? 3_600_000 : 60_000;
    const c0 = Math.max(0, Math.floor(Math.max(0, xMin) / colW));
    const c1 = Math.min(Math.ceil(contentW / colW), Math.ceil(xMax / colW));
    for (let c = c0; c < c1 && c < c0 + 1000; c++) {
      const units = ((c - 1) * colW) / ppu;
      const date = new Date(originMs + units * unitMs);
      scale.push(
        <div key={c} className="fg-scale-cell" style={{ left: c * colW, width: colW }}>
          {String(fmt(date, level))}
        </div>,
      );
    }
  }

  const label = props["aria-label"] ?? messages.chartLabel;
  const rootStyle = { ...props.style } as CSSProperties;
  return (
    <div
      ref={rootRef}
      className={props.className ? `fg-root ${props.className}` : "fg-root"}
      style={rootStyle}
      data-kb={kbMode ? "" : undefined}
      data-panning={panning ? "" : undefined}
      data-linking={linkDrag || kbLink ? "" : undefined}
      data-readonly={readOnly ? "" : undefined}
      onFocus={(e) => {
        // Only a focused grid row drives the focus chain highlight (D-22).
        const hit = hitTest(e.target);
        setHasFocus("row" in hit);
        try {
          if ((e.target as HTMLElement).matches(":focus-visible")) setKbMode(true);
        } catch {
          // older engines without :focus-visible
        }
        if ("row" in hit) {
          const i = stateRef.current.rows.order[hit.row];
          if (i !== undefined) setActiveId(stateRef.current.model.items[i]!.id);
        }
      }}
      onBlur={(e) => {
        const left = e.target;
        if (rootRef.current?.contains(e.relatedTarget as Node | null)) return;
        queueMicrotask(() => {
          // A row removed while focused (collapsed or deleted) keeps the chart "focused" so the
          // effect above can move focus to a visible row.
          if (!left.isConnected) return;
          if (rootRef.current?.contains(document.activeElement)) return;
          setHasFocus(false);
          setKbLink(null);
        });
      }}
    >
      <div
        ref={scrollerRef}
        className="fg-scroller"
        onScroll={(e) => {
          const t = e.currentTarget;
          const next = { left: t.scrollLeft, top: t.scrollTop };
          setScroll((s) => (s.left === next.left && s.top === next.top ? s : next));
          propsRef.current.onScroll?.(next);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e, false)}
        onPointerCancel={(e) => endPress(e, true)}
        onLostPointerCapture={(e) => {
          if (captured.current === e.pointerId) endPress(e, true);
        }}
        onPointerLeave={() => {
          if (!pressRef.current) setHoverId(null);
        }}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        onDoubleClick={onDoubleClick}
      >
        <div className="fg-content" style={{ width: gridW + contentW, height: headerH + bodyH }}>
          <div
            ref={gridRef}
            className="fg-grid"
            role="treegrid"
            aria-label={label}
            aria-multiselectable="true"
            aria-rowcount={rowCount + 1}
            aria-readonly={readOnly || undefined}
            style={{ width: gridW, height: headerH + bodyH }}
            onKeyDown={onKeyDown}
          >
            <div className="fg-grid-header" role="rowgroup" data-fg-area="header" style={{ height: headerH }}>
              <div role="row" className="fg-header-row" aria-rowindex={1} style={{ height: headerH }}>
                {resolvedColumns.map(({ col, style }) => (
                  <div key={col.id} role="columnheader" className="fg-header-cell" style={style}>
                    {col.header}
                  </div>
                ))}
              </div>
            </div>
            <div className="fg-grid-body" role="rowgroup" data-fg-area="grid" style={{ height: bodyH }}>
              {gridRows}
              {pinnedRow}
              {reorderMarker}
            </div>
            {resizableGrid ? (
              <div
                className="fg-splitter"
                aria-hidden="true"
                data-fg-area="splitter"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  pressRef.current = { kind: "splitter", pointerId: e.pointerId, x0: e.clientX, w0: gridW };
                }}
                onPointerMove={(e) => {
                  const p = pressRef.current;
                  if (p?.kind === "splitter" && p.pointerId === e.pointerId) {
                    setGridOverride(Math.max(0, Math.min(2000, p.w0 + e.clientX - p.x0)));
                  }
                }}
                onPointerUp={(e) => {
                  if (pressRef.current?.kind === "splitter") pressRef.current = null;
                  e.stopPropagation();
                }}
              />
            ) : null}
          </div>
          <div className="fg-timeline" aria-hidden="true" style={{ width: contentW, height: headerH + bodyH }}>
            <div className="fg-scale" data-fg-area="header" style={{ height: headerH }}>
              {scale}
            </div>
            <div
              className="fg-tbody"
              data-fg-area="timeline"
              style={{ height: bodyH, ["--fg-col-width" as string]: `${colW}px` }}
            >
              {layerNodes("below-rows")}
              {timelineRows}
              {layerNodes("below-bars")}
              <svg className="fg-links" width={contentW} height={bodyH}>
                {links}
              </svg>
              {bars}
              {layerNodes("above-bars")}
              {preview}
            </div>
          </div>
        </div>
      </div>
      <div className="fg-live" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </div>
  );
}

/** Flow Gantt chart (section 13.2). */
export const FlowGantt = forwardRef(FlowGanttInner) as <TData = unknown>(
  props: FlowGanttProps<TData> & { ref?: Ref<FlowGanttHandle> },
) => ReactElement;
