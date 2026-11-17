import type { CSSProperties, ReactNode } from "react";
import type {
  BaseUnit,
  FlowDataError,
  FlowDependency,
  FlowItem,
  FlowLayout,
  ItemId,
  ItemStatus,
} from "./layout/types.js";

export interface ZoomLevel {
  id: string;
  unit: "minute" | "hour";
  step: number;
  minColumnWidth: number;
  label?: string;
}

export interface FlowColumn<TData = unknown> {
  id: string;
  header: ReactNode;
  /** "fill" shares the remaining grid width. */
  width?: number | "fill";
  /** Shows indentation and the toggle; exactly one column (the first one marked wins). */
  tree?: boolean;
  /** Default: item.label as text. The returned node is trusted (SEC-1). */
  render?: (item: FlowItem<TData>) => ReactNode;
}

export interface BarRenderContext {
  width: number;
  height: number;
  selected: boolean;
  variant: string;
  status?: ItemStatus;
}

export interface ConnectContext<TData = unknown> {
  from: FlowItem<TData>;
  to: FlowItem<TData>;
  type: "finish-to-start";
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
}

export interface ReorderChange<TData = unknown> {
  item: FlowItem<TData>;
  newParentId: ItemId | null;
  /** Index among the new parent's children after the move. */
  newIndex: number;
}

export type FlowContextMenuTarget<TData = unknown> =
  | { type: "item"; item: FlowItem<TData> }
  | { type: "dependency"; dependency: FlowDependency }
  | { type: "empty" };

export type FlowContextMenuEvent<TData = unknown> = {
  target: FlowContextMenuTarget<TData>;
  area: "grid" | "timeline";
  clientX: number;
  clientY: number;
  nativeEvent: MouseEvent | KeyboardEvent | TouchEvent;
};

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ItemBoxes<TData = unknown> {
  item: FlowItem<TData>;
  bar: Box;
  row: Box;
}

export interface LayerContext<TData = unknown> {
  /** In timeline content coordinates. */
  visibleWindow: Box;
  visibleItems: readonly ItemBoxes<TData>[];
  /** Null when the item is hidden (inside a collapsed group) or unknown. */
  getItemBox: (id: ItemId) => { bar: Box; row: Box } | null;
  getChildrenBoxes: (groupId: ItemId) => readonly ItemBoxes<TData>[];
}

export interface FlowLayer<TData = unknown> {
  id: string;
  zIndex: "below-rows" | "below-bars" | "above-bars";
  /** The returned node is trusted (SEC-1). */
  render: (ctx: LayerContext<TData>) => ReactNode;
}

export interface FlowMessages {
  chartLabel: string;
  startsAfter: (labels: string[]) => string;
  followedBy: (labels: string[]) => string;
  none: string;
  status: Record<ItemStatus, string>;
  selectionCount: (count: number) => string;
  groupExpanded: (label: string) => string;
  groupCollapsed: (label: string) => string;
  linkingStarted: (label: string) => string;
  linkCandidate: (label: string, allowed: boolean) => string;
  dependencyCreated: (from: string, to: string) => string;
  dependencyRejected: (from: string, to: string) => string;
  rowMoved: (label: string, position: number) => string;
  /** Text equivalent of a bar variant (A11Y-11); empty string for none. */
  variant: (variant: string) => string;
  /** Added to the description of items on the longest path (X-2). */
  longestPath: string;
}

export interface FlowGanttProps<TData = unknown> {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
  origin: Date;

  baseUnit?: BaseUnit;
  defaultSpan?: number;
  dependencyGap?: number;
  initialSize?: { width: number; height: number };
  zoomLevels?: readonly ZoomLevel[];
  zoomLevel?: string;
  defaultZoomLevel?: string;
  onZoomLevelChange?: (levelId: string) => void;
  rowHeight?: number;
  barHeight?: number;
  headerHeight?: number;
  gridWidth?: number;
  resizableGrid?: boolean;
  showTimeScale?: boolean;
  formatScaleLabel?: (date: Date, level: ZoomLevel) => string;

  columns: readonly FlowColumn<TData>[];

  renderBar?: (item: FlowItem<TData>, ctx: BarRenderContext) => ReactNode;
  getBarVariant?: (item: FlowItem<TData>, ctx: { predecessors: readonly FlowItem<TData>[] }) => string;
  getItemStatus?: (item: FlowItem<TData>) => ItemStatus | undefined;
  getStatusText?: (item: FlowItem<TData>) => string;
  getAccessibleLabel?: (item: FlowItem<TData>) => string;
  groupFrames?: boolean;
  chainHighlight?: "none" | "direct" | "full";
  highlightLongestPath?: boolean;
  highlightedIds?: readonly ItemId[];
  stickyGroupHeaders?: boolean;
  animateLayout?: boolean;
  previewDependencyLayout?: boolean;
  fitOnLoad?: boolean;
  linkEndMarker?: "dot" | "arrow";
  layers?: readonly FlowLayer<TData>[];

  selectedIds?: readonly ItemId[];
  defaultSelectedIds?: readonly ItemId[];
  onSelectionChange?: (ids: ItemId[], info: { source: "pointer" | "keyboard" | "api" }) => void;
  collapsedIds?: readonly ItemId[];
  defaultCollapsedIds?: readonly ItemId[];
  onCollapsedChange?: (ids: ItemId[]) => void;

  readOnly?: boolean;
  canConnectFrom?: (item: FlowItem<TData>) => boolean;
  canConnect?: (ctx: ConnectContext<TData>) => boolean;
  onDependencyCreate?: (draft: { from: ItemId; to: ItemId; type: "finish-to-start" }) => void;
  canReorder?: (change: ReorderChange<TData>) => boolean;
  onReorder?: (change: ReorderChange<TData>) => void;
  onDeleteRequest?: (ids: ItemId[]) => void;

  onContextMenu?: (event: FlowContextMenuEvent<TData>) => boolean | undefined;
  onItemDoubleClick?: (item: FlowItem<TData>) => void;
  onItemActivate?: (item: FlowItem<TData>) => void;
  onLayoutChange?: (layout: FlowLayout) => void;
  onScroll?: (pos: { left: number; top: number }) => void;
  onDataError?: (errors: FlowDataError[]) => void;

  messages?: Partial<FlowMessages>;
  keyboardShortcuts?: { beginDependency?: boolean; reorder?: boolean };

  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

export interface FlowGanttHandle {
  scrollToItem(id: ItemId, options?: { align?: "start" | "center" | "nearest"; behavior?: ScrollBehavior }): void;
  scrollTo(pos: { left?: number; top?: number }): void;
  getScroll(): { left: number; top: number };
  /** Timeline content coordinates. */
  getItemBox(id: ItemId): { bar: Box; row: Box } | null;
  focusItem(id: ItemId): void;
  beginDependency(fromId: ItemId): void;
  cancelInteraction(): void;
  fitToView(options?: { ids?: readonly ItemId[] }): void;
  flashItem(id: ItemId): void;
}
