// Pure data helpers (`@sychpl/flow-gantt/ops`), section 7 of the spec.
// Helpers never mutate their inputs and never generate ids on their own (GRP-6).

import type { FlowDependency, FlowItem, ItemId } from "../layout/types.js";

export interface FlowState<TData = unknown> {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
}

const parentOf = (item: FlowItem<unknown>): ItemId | null => item.parentId ?? null;

const touches = (d: FlowDependency, ids: ReadonlySet<ItemId>) => ids.has(d.from) || ids.has(d.to);

function dropDeps<TData>(
  state: FlowState<TData>,
  items: FlowItem<TData>[],
  ids: ReadonlySet<ItemId>,
): FlowState<TData> {
  return { items, dependencies: ids.size ? state.dependencies.filter((d) => !touches(d, ids)) : state.dependencies };
}

/** Ids of groups that had children in `before` and have none in `after`, except `keep`. */
function emptiedGroups<TData>(
  before: readonly FlowItem<TData>[],
  after: readonly FlowItem<TData>[],
  keep?: ItemId,
): Set<ItemId> {
  const had = new Set<ItemId>();
  for (const it of before) if (it.parentId != null) had.add(it.parentId);
  for (const it of after) if (it.parentId != null) had.delete(it.parentId);
  if (keep !== undefined) had.delete(keep);
  const groups = new Set<ItemId>();
  for (const it of after) if (it.kind === "group" && had.has(it.id)) groups.add(it.id);
  return groups;
}

/** GRP-5: appends leaves to a parent (or top level), optionally chained by dependencies. */
export function addItems<TData>(
  state: FlowState<TData>,
  newItems: readonly FlowItem<TData>[],
  options: { parentId?: ItemId | null; chain?: boolean; gap?: number; newDependencyId: () => string },
): FlowState<TData> {
  const parentId = options.parentId ?? null;
  const added = newItems.map((it) => ({ ...it, parentId }));
  const dependencies = [...state.dependencies];
  if (options.chain) {
    const leaves = added.filter((it) => it.kind !== "group");
    for (let i = 1; i < leaves.length; i++) {
      const dep: FlowDependency = {
        id: options.newDependencyId(),
        from: leaves[i - 1]!.id,
        to: leaves[i]!.id,
        type: "finish-to-start",
      };
      if (options.gap !== undefined) dep.gap = options.gap;
      dependencies.push(dep);
    }
  }
  return { items: [...state.items, ...added], dependencies };
}

/** GRP-4: removes items, children of removed groups, touching dependencies and groups left empty. */
export function removeItems<TData>(state: FlowState<TData>, ids: readonly ItemId[]): FlowState<TData> {
  const gone = new Set(ids);
  for (const it of state.items) if (it.parentId != null && gone.has(it.parentId)) gone.add(it.id);
  let items = state.items.filter((it) => !gone.has(it.id));
  for (const g of emptiedGroups(state.items, items)) gone.add(g);
  items = items.filter((it) => !gone.has(it.id));
  return dropDeps(state, items, gone);
}

/** GRP-2: moves leaves into an existing group or a new group appended at the end. */
export function moveToGroup<TData>(
  state: FlowState<TData>,
  leafIds: readonly ItemId[],
  target: { groupId: ItemId } | { newGroup: FlowItem<TData> },
): FlowState<TData> {
  let groupId: ItemId;
  let newGroup: FlowItem<TData> | undefined;
  if ("newGroup" in target) {
    newGroup = { ...target.newGroup, kind: "group", parentId: null };
    groupId = newGroup.id;
  } else {
    groupId = target.groupId;
    const g = state.items.find((it) => it.id === groupId);
    if (g?.kind !== "group") return state;
  }
  const wanted = new Set(leafIds);
  const moving = state.items.filter(
    (it) => wanted.has(it.id) && it.kind !== "group" && (newGroup !== undefined || parentOf(it) !== groupId),
  );
  if (moving.length === 0 && !newGroup) return state;
  const movedIds = new Set(moving.map((it) => it.id));
  const kept = state.items.filter((it) => !movedIds.has(it.id));
  const moved = moving.map((it) => ({ ...it, parentId: groupId }));
  let items = [...kept, ...(newGroup ? [newGroup] : []), ...moved];
  const emptied = emptiedGroups(state.items, items, groupId);
  if (emptied.size) items = items.filter((it) => !emptied.has(it.id));
  return dropDeps(state, items, new Set([...movedIds, ...emptied]));
}

/** GRP-3: moves a group's leaves (or one leaf) to the top level. */
export function ungroup<TData>(state: FlowState<TData>, id: ItemId): { state: FlowState<TData>; movedIds: ItemId[] } {
  const target = state.items.find((it) => it.id === id);
  if (!target) return { state, movedIds: [] };
  if (target.kind === "group") {
    const kids = state.items.filter((it) => parentOf(it) === id);
    const movedIds = kids.map((it) => it.id);
    const lifted = kids.map((it) => ({ ...it, parentId: null }));
    const items: FlowItem<TData>[] = [];
    for (const it of state.items) {
      if (it.id === id) items.push(...lifted);
      else if (parentOf(it) !== id) items.push(it);
    }
    return { state: dropDeps(state, items, new Set([...movedIds, id])), movedIds };
  }
  const groupId = parentOf(target);
  if (groupId === null) return { state, movedIds: [] };
  let items = state.items.map((it) => (it.id === id ? { ...it, parentId: null } : it));
  const gone = new Set([id]);
  for (const g of emptiedGroups(state.items, items)) gone.add(g);
  if (gone.size > 1) items = items.filter((it) => !gone.has(it.id) || it.id === id);
  return { state: dropDeps(state, items, gone), movedIds: [id] };
}

/** Removes every dependency with the given id. */
export function removeDependency<TData>(state: FlowState<TData>, dependencyId: string): FlowState<TData> {
  return { items: state.items, dependencies: state.dependencies.filter((d) => d.id !== dependencyId) };
}

/**
 * Moves an item to `newIndex` among the children of `newParentId` (null: top level),
 * where the index is counted after removing the item from its old position.
 */
export function reorder<TData>(
  state: FlowState<TData>,
  change: { itemId: ItemId; newParentId: ItemId | null; newIndex: number },
): FlowState<TData> {
  const item = state.items.find((it) => it.id === change.itemId);
  if (!item) return state;
  const newParentId = change.newParentId ?? null;
  if (newParentId !== null) {
    const parent = state.items.find((it) => it.id === newParentId);
    if (parent?.kind !== "group" || item.kind === "group") return state;
  }
  const rest = state.items.filter((it) => it !== item);
  const siblings = rest.filter((it) => parentOf(it) === newParentId);
  const index = Math.max(0, Math.min(Math.trunc(change.newIndex) || 0, siblings.length));
  const moved = parentOf(item) === newParentId ? item : { ...item, parentId: newParentId };
  let at: number;
  if (index < siblings.length) at = rest.indexOf(siblings[index]!);
  else if (siblings.length > 0) at = rest.indexOf(siblings[siblings.length - 1]!) + 1;
  else if (newParentId !== null) at = rest.findIndex((it) => it.id === newParentId) + 1;
  else at = rest.length;
  return { items: [...rest.slice(0, at), moved, ...rest.slice(at)], dependencies: state.dependencies };
}
