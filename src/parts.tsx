// Presentational pieces of the chart. All host strings are rendered as React text (SEC-1).

import { type CSSProperties, memo, type ReactNode } from "react";
import type { FlowItem, ItemStatus } from "./layout/types.js";
import type { Box, FlowColumn, ItemBoxes, LayerContext } from "./types.js";

export interface ResolvedColumn<TData> {
  col: FlowColumn<TData>;
  style: CSSProperties;
  tree: boolean;
}

const bool = (v: boolean) => (v ? "true" : "false");

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
  </svg>
);

export interface GridRowProps<TData> {
  item: FlowItem<TData>;
  row: number;
  top: number;
  height: number;
  level: number;
  setsize: number;
  posinset: number;
  isGroup: boolean;
  collapsed: boolean;
  selected: boolean;
  status: ItemStatus | undefined;
  alt: boolean;
  lastChild: boolean;
  active: boolean;
  dimmed: boolean;
  label: string;
  description: string;
  descId: string | undefined;
  columns: readonly ResolvedColumn<TData>[];
  /** Presentational copy (sticky group header, X-4). */
  pinned?: boolean;
}

function GridRowImpl<TData>(p: GridRowProps<TData>) {
  const { item, isGroup } = p;
  const cells = p.columns.map(({ col, style, tree }) => (
    <div
      key={col.id}
      role={p.pinned ? undefined : "gridcell"}
      className="fg-cell"
      style={style}
      data-tree={tree || undefined}
    >
      {tree && isGroup ? (
        <span className="fg-toggle" data-fg-toggle="" aria-hidden="true">
          <Chevron />
        </span>
      ) : null}
      <span className="fg-cell-text">
        {p.pinned ? (tree ? String(item.label ?? "") : null) : col.render ? col.render(item) : String(item.label ?? "")}
      </span>
    </div>
  ));
  const data = {
    "data-fg-row": p.row,
    "data-kind": isGroup ? "group" : "leaf",
    "data-level": p.level,
    "data-selected": bool(p.selected),
    "data-status": p.status,
    "data-collapsed": isGroup ? bool(p.collapsed) : undefined,
    "data-alt": !isGroup && p.alt ? "" : undefined,
    "data-last": p.lastChild ? "" : undefined,
    "data-dimmed": p.dimmed ? "" : undefined,
  };
  const style = { top: p.top, height: p.height };
  if (p.pinned) {
    return (
      <div className="fg-row fg-row-pinned" aria-hidden="true" style={style} {...data}>
        {cells}
      </div>
    );
  }
  return (
    <div
      role="row"
      className="fg-row"
      aria-level={p.level}
      aria-setsize={p.setsize}
      aria-posinset={p.posinset}
      aria-selected={p.selected}
      aria-expanded={isGroup ? !p.collapsed : undefined}
      aria-rowindex={p.row + 2}
      aria-label={p.label}
      aria-describedby={p.descId}
      tabIndex={p.active ? 0 : -1}
      style={style}
      {...data}
    >
      {cells}
      {p.descId ? (
        <span id={p.descId} hidden>
          {p.description}
        </span>
      ) : null}
    </div>
  );
}
export const GridRow = memo(GridRowImpl) as typeof GridRowImpl;

export interface BarProps<TData> {
  item: FlowItem<TData>;
  row: number;
  box: Box;
  isGroup: boolean;
  level: number;
  collapsed: boolean;
  variant: string;
  selected: boolean;
  status: ItemStatus | undefined;
  dimmed: boolean;
  onPath: boolean;
  handles: boolean;
  drop: "valid" | "invalid" | undefined;
  flash: number;
  renderBar: ((item: FlowItem<TData>, ctx: import("./types.js").BarRenderContext) => ReactNode) | undefined;
}

function BarImpl<TData>(p: BarProps<TData>) {
  const { box } = p;
  const content = p.renderBar ? (
    p.renderBar(p.item, {
      width: box.width,
      height: box.height,
      selected: p.selected,
      variant: p.variant,
      status: p.status,
    })
  ) : (
    <span className="fg-bar-label">{String(p.item.label ?? "")}</span>
  );
  return (
    <div
      className="fg-bar"
      data-fg-bar={p.row}
      data-kind={p.isGroup ? "group" : "leaf"}
      data-variant={p.variant}
      data-level={p.level}
      data-selected={bool(p.selected)}
      data-status={p.status}
      data-collapsed={p.isGroup ? bool(p.collapsed) : undefined}
      data-dimmed={p.dimmed ? "" : undefined}
      data-path={p.onPath ? "" : undefined}
      data-drop={p.drop}
      data-flash={p.flash > 0 ? p.flash % 2 : undefined}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <div className="fg-bar-content">{content}</div>
      {p.handles ? (
        <>
          <span className="fg-handle" data-fg-handle="left" />
          <span className="fg-handle" data-fg-handle="right" />
        </>
      ) : null}
    </div>
  );
}
export const Bar = memo(BarImpl) as typeof BarImpl;

/** REN-33: built-in group frames, implemented as a layer (LAYER-3). */
export function renderGroupFrames<TData>(
  ctx: LayerContext<TData>,
  groups: readonly { id: string; first: number; last: number }[],
  rowHeight: number,
): ReactNode {
  const win = ctx.visibleWindow;
  const out: ReactNode[] = [];
  for (const g of groups) {
    const top = g.first * rowHeight;
    const bottom = (g.last + 1) * rowHeight;
    if (bottom < win.top - win.height || top > win.top + 2 * win.height) continue;
    const head = ctx.getItemBox(g.id);
    const kids = ctx.getChildrenBoxes(g.id);
    if (!head || kids.length === 0) continue;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const k of kids) {
      minX = Math.min(minX, k.bar.left);
      maxX = Math.max(maxX, k.bar.left + k.bar.width);
    }
    const firstRow = kids[0]!.row;
    const lastBar = (kids[kids.length - 1] as ItemBoxes<TData>).bar;
    const b = head.bar;
    out.push(
      <div
        key={`h:${g.id}`}
        className="fg-frame fg-frame-head"
        style={{ left: b.left - 6, top: b.top - 2, width: b.width + 12, height: b.height + 4 }}
      />,
      <div
        key={`b:${g.id}`}
        className="fg-frame fg-frame-body"
        style={{
          left: minX - 6,
          top: firstRow.top,
          width: maxX - minX + 12,
          height: lastBar.top + lastBar.height + 6 - firstRow.top,
        }}
      />,
    );
  }
  return out;
}
