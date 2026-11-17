export type ItemId = string;

export interface FlowItem<TData = unknown> {
  /** Unique across all items. */
  id: ItemId;
  kind: "group" | "leaf";
  /** Id of a group, or null/undefined for top level. */
  parentId?: ItemId | null;
  /** Plain text, never parsed as HTML. */
  label: string;
  /** Bar length in base units; default `defaultSpan`. Ignored on groups. */
  span?: number;
  /** Opaque host payload, never read by the library. */
  data?: TData;
}

export interface FlowDependency {
  id: string;
  /** Predecessor. */
  from: ItemId;
  /** Successor. */
  to: ItemId;
  type?: "finish-to-start";
  /** Base units between predecessor end and successor start; default `dependencyGap`. */
  gap?: number;
}

export type ItemStatus = "error" | "warning" | "success" | "running" | "pending" | "skipped";

export type FlowDataError =
  | { code: "duplicate-id" | "unknown-parent" | "invalid-parent" | "nested-group" | "invalid-id"; itemId: ItemId }
  | {
      code:
        | "unknown-endpoint"
        | "self-dependency"
        | "unsupported-type"
        | "cycle"
        | "duplicate-dependency"
        | "duplicate-dependency-id"
        | "invalid-id";
      dependencyId: string;
    }
  | { code: "unsupported-field"; itemId: ItemId; field: string }
  | { code: "invalid-origin" | "invalid-option" | "extent-too-large"; detail: string }
  | { code: "invalid-number"; itemId?: ItemId; dependencyId?: string; field: string };

export interface FlowLayoutEntry {
  id: ItemId;
  startUnits: number;
  endUnits: number;
  start: Date;
  end: Date;
}

export interface FlowLayout {
  entries: ReadonlyMap<ItemId, FlowLayoutEntry>;
  /** Always 0 (the origin). */
  minUnits: number;
  /** Latest end. */
  maxUnits: number;
  errors: readonly FlowDataError[];
  /** X-2, in order from first to last item. */
  longestPath: readonly ItemId[];
}

export type BaseUnit = "minute" | "hour";

export interface LayoutInput<TData = unknown> {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
  origin: Date;
  baseUnit?: BaseUnit;
  defaultSpan?: number;
  dependencyGap?: number;
}
