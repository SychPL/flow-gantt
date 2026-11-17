# Flow Gantt - clean-room functional specification

Status: phase A deliverable, version 1.1, 2026-11-16 (open questions settled with an independent Codex review, see section 17; features beyond parity added in section 18).
Product name: **Flow Gantt**, npm package `@sychpl/flow-gantt`, repository `SychPL/flow-gantt`, CSS prefix `--fg-`, class prefix `fg-`. License: MIT.

This document is the only input that phase B (the implementers) may use, together with the host application's own source code (outside the replaced library) and the public specifications it references (WAI-ARIA, WCAG, React, CSS). It describes what the library must do, not how any existing library does it.

## 0. Rules for phase B readers

1. Do not open, decompile, read the documentation of, or look at the running output (DOM, CSS, network) of dhtmlxGantt or any modified copy of it. A host application may still have such a package installed; never open its files. Do not search the web for its source, demos or docs. If you need a behaviour that this spec does not define, ask the spec owner instead of looking it up.
2. Do not treat names from the replaced library's API as design input; the public API of Flow Gantt is defined in section 13.
3. All numbers in this spec (pixel sizes, colours, timings) come from the host application's own code and design tokens, or from black-box measurements of the host application's screen. They describe the target look and feel and may be changed by the spec owner.
4. Requirement levels: **MUST** (needed for parity with the replaced chart view, or for safety), **SHOULD** (expected in v1, can slip with sign-off), **MAY** (optional). Every requirement has an ID (for example `LAY-3`) that tests refer to.

## 1. Context

A host application runs **jobs** arranged in an ordered list of **groups**; each group contains an ordered list of jobs, and a job may also stand on its own at the top level. Jobs and groups can depend on each other ("start after X finishes"). The host shows this as a Gantt-style flow chart: a tree grid on the left and a timeline of bars and dependency connectors on the right. The user can add, remove, group, ungroup and connect jobs, and the host saves the whole structure.

The chart is a **flow diagram drawn on a time axis**, not a calendar plan:

- Bars do not represent real durations. Every job bar has the same nominal length.
- A bar's horizontal position is derived only from the dependency graph: an item starts at the chart origin, at the start of its group, or just after the latest of its predecessors ends.
- Delays and repetition settings are shown as badges inside the bar and do not move the bar.
- The time scale labels can be hidden (the example host configuration hides them).

The first host built this view on a modified copy of a commercial Gantt library whose license does not allow publishing modified code. Flow Gantt replaces it and will be published as open source.

## 2. Goals and non-goals

### Goals

- G1. Full functional parity with the replaced flow chart view as described in sections 4 to 11, so the host can switch with no loss of functionality.
- G2. React-first, controlled component: the host owns the data (items, dependencies, selection, expansion state) and receives change requests through callbacks. No hidden internal copy of the data that the host must keep in sync.
- G3. Deterministic, pure layout function that can be unit tested without a DOM.
- G4. Theming only through CSS custom properties, so the host maps its design-system tokens without overriding internal selectors.
- G5. Accessible: keyboard operable, screen-reader friendly treegrid, WCAG 2.2 AA.
- G6. Fast with thousands of rows: virtualised rendering, 60 fps scrolling.
- G7. Safe by construction: no host string is ever inserted as HTML.
- G8. Small, dependency-free (React as the only peer dependency), MIT-licensable, independently written.

### Non-goals for v1

- NG1. Dragging bars to move them or resizing bars (the replaced view had both disabled).
- NG2. Calendars, working time, holidays, time zones beyond the browser's local time, durations in days or weeks.
- NG3. Baselines, resource views, progress bars, deadlines, constraints other than finish-to-start. (A longest-path highlight is in scope, X-2.)
- NG4. Built-in edit dialogs, inline cell editors, tooltips with content, quick-info popups. The host renders its own drawers and menus.
- NG5. Export (PDF, PNG, Excel), printing, fullscreen mode, undo/redo.
- NG6. Real-time collaborative editing.
- NG7. Dependency types other than finish-to-start (the data type reserves room for them, see DATA-6).

Note: the replaced integration also switched on several optional features that were never used in a visible way (for example fullscreen, critical path, built-in tooltips and pop-up summaries, date markers). Only dependency-driven placement (section 4), panning, multi-selection, grouping and custom drawing layers are visible to users. The unused features are deliberately out of scope.

## 3. Data model

### 3.1 Items

```ts
type ItemId = string;

interface FlowItem<TData = unknown> {
  id: ItemId; // unique across all items
  kind: "group" | "leaf";
  parentId?: ItemId | null; // id of a group, or null/undefined for top level
  label: string; // plain text; used for accessibility and default rendering
  span?: number; // bar length in time units; default options.defaultSpan
  data?: TData; // opaque host payload, never read by the library
}
```

- DATA-1 (MUST) Items form a tree of depth at most 2: groups at top level, leaves either at top level or inside a group. A leaf cannot be a parent. A group cannot be inside another group. Invalid input (unknown parent, leaf as parent, nested group, duplicate id) is reported through `onDataError` (section 12) and the offending item is shown at top level; rendering never throws. When ids are duplicated, only the first occurrence in the `items` array is used; later ones are reported and not rendered.
- DATA-2 (MUST) Display order is the order of the `items` array, filtered per parent. A group's children are shown directly under the group in the order they appear in the array, regardless of where they appear relative to the group.
- DATA-3 (MUST) `label` is plain text. The library never parses it as HTML or Markdown.
- DATA-4 (MUST) `data` is passed back unchanged in callbacks and render props. The library does not clone or mutate it.
- DATA-5 (SHOULD) A depth limit option (`maxDepth`, default 2) MAY be raised later; v1 only has to support 2.

### 3.2 Dependencies

```ts
interface FlowDependency {
  id: string;
  from: ItemId; // predecessor
  to: ItemId; // successor
  type?: "finish-to-start"; // the only supported value in v1, and the default
  gap?: number; // time units between predecessor end and successor start; default options.dependencyGap
}
```

- DATA-6 (MUST) Only finish-to-start is supported. Any other `type` value is reported through `onDataError` and the dependency is ignored for layout and drawing.
- DATA-7 (MUST) A dependency whose `from` or `to` does not exist, or that points from an item to itself, is ignored and reported.
- DATA-8 (MUST) Duplicate dependencies (same `from` and `to`) are drawn once and count once; the first one in input order wins (its `id` and `gap` are used) and the others are reported.
- DATA-9 (MUST) Cycles are detected on the **combined layout graph**, which contains every valid dependency plus two implicit constraints per group: each child starts no earlier than its group starts (group start to child start), and the group ends when its last child ends (child end to group end). A dependency between a group and one of its own children (in either direction) is always invalid, is reported with code `cycle` and is ignored. For other cycles the library runs a depth-first traversal over the combined graph, starting from items in display order; when it meets an edge that points back to a node on the current path, it ignores the most recently traversed explicit dependency on that cycle (implicit constraints are never ignored), reports it with code `cycle`, and continues. Ignored dependencies are drawn with the invalid style (THEME-1 `--fg-link-invalid-color`). Layout always terminates.
- DATA-10 (MUST) The library does not restrict which items may be connected; restrictions are the host's job through `canConnect` (INT-12). The example host configuration allows only siblings (same parent, or both top level), see INT-16.

### 3.3 Selection and expansion state

- DATA-11 (MUST) Selection is a set of item ids owned by the host (`selectedIds` prop, `onSelectionChange` callback). Groups and leaves can both be selected.
- DATA-12 (MUST) Expansion is owned by the host (`collapsedIds` prop, `onCollapsedChange` callback). A group not listed is expanded. If the host does not pass `collapsedIds`, the library manages expansion internally (uncontrolled mode) starting with all groups expanded.
- DATA-13 (MUST) Ids in `selectedIds` or `collapsedIds` that do not exist are ignored without error.

### 3.4 Item status

- DATA-14 (MUST) The host can mark items with a status through `getItemStatus(item) => ItemStatus | undefined`, where `ItemStatus` is `"error" | "warning" | "success" | "running" | "pending" | "skipped"` (X-5). Status only affects styling and accessible text (REN-32, A11Y-8). For example, a host can use `error` for items it considers invalid.
- DATA-15 (MUST) Input bounds. `origin` must be a valid Date; otherwise the chart renders the grid and an empty timeline and reports `invalid-origin`. `span` and `gap` must be finite numbers; a non-finite or non-positive `span` and a non-finite `gap` fall back to the defaults and are reported (`invalid-number`). Gaps may be negative but are clamped so a successor never starts before its predecessor starts. Size props are clamped to sane ranges (row height 16 to 200 px, bar height 4 px to row height, header 0 to 200 px, grid width 0 to 2000 px, column width 8 to 2000 px, zoom step a positive integer) and out-of-range values are reported (`invalid-option`). The timeline content width is capped at 2,000,000 px; beyond that the library reports `extent-too-large` and switches to the coarsest zoom level that fits.

## 4. Layout model (time positions)

The library computes a start and end for every item from the graph. Units are abstract **time units** mapped to real time by the zoom level (section 9). The example host configuration uses minutes.

Definitions: `O` is the chart origin (`origin` prop, a Date). `span(i)` is the item's span or `defaultSpan`. `gap(d)` is the dependency's gap or `dependencyGap`. `preds(i)` are the items with a valid dependency into `i`.

- LAY-1 (MUST) Default constants: `defaultSpan = 3`, `dependencyGap = 0.5`, `baseUnit = "minute"`. All three are options. Spans and gaps are always expressed in the **base unit**, which is independent of the display zoom (section 9): zoom only changes how many pixels one base unit takes.
- LAY-2 (MUST) Leaf start:
  - top-level leaf with no predecessors: `O`;
  - leaf inside group `g` with no predecessors: `start(g)`;
  - leaf with predecessors: `max(end(p) + gap(d))` over its predecessors, and never earlier than `start(g)` when it is inside group `g`.
- LAY-3 (MUST) Leaf end: `start + span`.
- LAY-4 (MUST) Group start: `O` when it has no predecessors, otherwise `max(end(p) + gap(d))` over its predecessors.
- LAY-5 (MUST) Group end: the latest end among its children. A group with no children ends at `start + defaultSpan` (hosts usually remove empty groups themselves).
- LAY-6 (MUST) A group's bar is one continuous bar covering `[start(g), end(g)]`, which is the enclosing interval of its children's bars (children start no earlier than the group and the group ends with its last child; gaps between children are inside the group bar).
- LAY-7 (MUST) Predecessors of a group or of a top-level item may be groups or top-level leaves (a top-level leaf behaves like a group with a single job). Predecessors of a leaf inside a group may be any item; when a predecessor is a group, its end is the group end.
- LAY-8 (MUST) Layout is a pure function of `(items, dependencies, origin, options)`. It does not depend on previous layouts, scroll position, expansion state or selection. After any change, the layout equals the layout a fresh mount with the same data would produce. (The replaced library sometimes left items at stale positions after a dependency or item was removed, so the host had to flag them until the user re-ran the layout; with LAY-8 that state cannot happen.)
- LAY-9 (MUST) Collapsing a group does not change any start or end.
- LAY-10 (MUST) Layout runs in O(items + dependencies) time after a topological sort and is exported as a standalone function `computeLayout` (section 13.4) so hosts and tests can use it without rendering.
- LAY-11 (SHOULD) An item MAY carry a fixed `start` (Date) in a future version. v1 only reserves the name: if `start` is present the library reports it as unsupported and ignores it.

Worked example (default settings, 100 px per minute):

| Item                                            | Rule  | Start (min after O) | End  |
| ----------------------------------------------- | ----- | ------------------- | ---- |
| Group "Setup", no predecessors                  | LAY-4 | 0                   | 6.5  |
| Leaf "Login" in Setup                           | LAY-2 | 0                   | 3    |
| Leaf "Check stock" in Setup, after Login        | LAY-2 | 3.5                 | 6.5  |
| Group "Sales flow", after Setup                 | LAY-4 | 7                   | 13.5 |
| Leaf "Run MRP", top level                       | LAY-2 | 0                   | 3    |
| Group "Month end", after Sales flow and Run MRP | LAY-4 | 14                  | 24   |

This matches the black-box observation of the replaced chart with the same data.

## 5. Layout and rendering of the chart

### 5.1 Overall structure

- REN-1 (MUST) The component fills its parent element (100% width and height) and reacts to size changes of the parent without a page reload.
- REN-2 (MUST) Two panes side by side: the **grid** (left) and the **timeline** (right). Default grid width 360 px (`gridWidth` option). The timeline takes the remaining width.
- REN-3 (SHOULD) A draggable splitter between the panes MAY be enabled with `resizableGrid`; off by default.
- REN-4 (MUST) A header strip of fixed height (default 35 px, `headerHeight`) spans both panes. The grid header shows column titles. The timeline header shows the time scale (section 9) or stays empty when the scale is hidden (`showTimeScale: false`, as in the example host configuration). The empty strip keeps the timeline rows aligned with the grid rows.
- REN-5 (MUST) Rows have a fixed height, default 36 px (`rowHeight`). One row per visible item: a group row, then its children (unless collapsed), in display order.
- REN-6 (MUST) Vertical scrolling is shared: grid and timeline scroll together and never drift apart, including during momentum scrolling and when the user scrolls either pane.
- REN-7 (MUST) Horizontal scrolling applies to the timeline only. The grid does not scroll horizontally in the example host configuration (single column filling the width).
- REN-8 (MUST) Scrollbars are visible when content overflows and use the platform's native scrollbars (thin styling allowed through tokens).

### 5.2 Timeline extent

- REN-9 (MUST) The timeline starts one column before `O` and ends at least two columns after the latest item end, and is never narrower than the visible timeline width. (Observed on the replaced chart: origin at one column from the left edge; 25 columns of content plus 2 columns of trailing space.)
- REN-10 (MUST) Vertical grid lines mark every column boundary in the timeline body (thin, `--fg-grid-line-color`). Rows have a thin bottom separator in both panes.

### 5.3 Grid pane

- REN-11 (MUST) Columns are host-defined (`columns` prop). Example host configuration: one column titled "ID Name" that fills the width, is the tree column, and shows `#<jobId> <name>` for leaves and `<name>` for groups (host render function).
- REN-12 (MUST) The tree column shows an expand/collapse toggle before each group label: a 28 px circle with a chevron pointing up when expanded and down when collapsed, coloured with `--fg-toggle-*` tokens. Leaves show no toggle and no file or folder icon.
- REN-13 (MUST) Children are indented relative to their group by at least the toggle width. A top-level leaf aligns with group labels minus the toggle (it is visually distinct from a child).
- REN-14 (MUST) Cell content is vertically centred. Text that does not fit is cut with an ellipsis; the full text is available to assistive technology (A11Y-4).

### 5.4 Bars

- REN-15 (MUST) A bar is drawn in its item's row from `start` to `end`. Bar height defaults to `rowHeight - 5` (31 px at 36 px rows) and is vertically centred (`barHeight` option).
- REN-16 (MUST) Leaf bars: rounded corners (4 px, `--fg-bar-radius`), 1 px border, padding so the content starts 8 px from the left edge. Default content: the label in one line with ellipsis. The example host replaces the content with a render function (`renderBar`) that shows a small `#<jobId>` caption, the name, and right-aligned badges (delay with a clock icon and a humanised duration such as "10 seconds"; repetition such as "x 3 P"). The library must give `renderBar` the full bar box (flex row, overflow hidden).
- REN-17 (MUST) Group bars: no fill and no border by default; the label is bold. Group bars are always drawn, also when the group is collapsed.
- REN-18 (MUST) Bar appearance is host-controlled through `getBarVariant(item) => string`. The library ships variants `default`, `dependent`, `delayed`, and `group`, each mapped to tokens (section 10). Example host rule: groups use `group`; a leaf with a delay greater than 0 uses `delayed`; otherwise a leaf with at least one predecessor uses `dependent`; otherwise `default`. Unknown variant names are passed through as a `data-variant` attribute so hosts can style them.
- REN-19 (MUST) Bar text colour, background and border come from the variant tokens. Bar content inherits the font size of the chart (13 px default) unless the host content sets its own.

### 5.5 Dependency connectors

- REN-20 (MUST) A dependency is drawn as an orthogonal connector from the vertical centre of the predecessor's right edge to the vertical centre of the successor's left edge.
- REN-21 (MUST) Normal routing (successor starts at least 2 stub lengths after the predecessor ends): right from the source for a short stub (about 12 px), then vertical to the target row centre, then right into the target. Lines are 2 px wide, colour `--fg-link-color`.
- REN-22 (MUST) Backward or tight routing (target starts before source end plus 2 stubs, for example with custom gaps): right stub from the source, vertical to the boundary between source and target rows, left to a point one stub before the target start, vertical to the target row centre, right into the target. Connectors never pass through the source or target bar.
- REN-23 (MUST) The end of the connector carries a marker: a filled circle 8 px in diameter in the link colour (the look of the replaced chart). A marker style option (`linkEndMarker: "dot" | "arrow"`) SHOULD exist, default `"dot"`.
- REN-24 (MUST) Each connector has an invisible hit area at least 24 px wide along all segments so it can be right-clicked or clicked easily (A11Y-13). Where hit areas of neighbouring connectors overlap, the connector drawn last (topmost) wins.
- REN-25 (MUST) Connectors to or from a collapsed group's children are not drawn. Connectors to or from the collapsed group itself are drawn.
- REN-26 (MUST) Connectors are drawn below bars and above row backgrounds. A dependency on a selected item MAY be emphasised (SHOULD, `--fg-link-selected-color`).

### 5.6 Rows, striping and states

- REN-27 (MUST) Row backgrounds in the grid: leaf rows alternate between `--fg-row-bg` and `--fg-row-alt-bg` based on the leaf's index within its parent (first child uses the alternate colour, second the base colour, and so on; top-level leaves count their index among top-level items). The visual rhythm depends on this per-parent striping, not on the global row index.
- REN-28 (MUST) Group rows in the grid: background `--fg-group-row-bg`, bold text, and a 1 px top border in `--fg-group-divider-color`.
- REN-29 (MUST) The last child row of each group has a 1 px bottom border in `--fg-group-divider-color`, so each group reads as a block.
- REN-30 (MUST) Timeline rows have a neutral background (`--fg-timeline-row-bg`) and no striping.
- REN-31 (MUST) Selected items: the grid row and the timeline row use `--fg-row-selected-bg` (groups use the stronger `--fg-group-row-selected-bg`), and the bar gets an outer glow ring (`--fg-bar-selected-ring`, 5 px blur by default) in addition to its variant colours.
- REN-32 (MUST) Items with status `error`: grid row background `--fg-row-error-bg` (groups `--fg-group-row-error-bg`), timeline row background `--fg-timeline-row-error-bg`. Error wins over selected for the background; the selection ring stays on the bar.

### 5.7 Group frames (layer)

- REN-33 (MUST) When a group is expanded and has at least one child, the library draws a **group frame** in the timeline:
  - a header frame around the group bar: 6 px wider than the bar on both sides, as tall as the bar plus 4 px, 1 px border on all sides, radius 4 px, translucent background;
  - a body frame around the children's bars: from 6 px left of the earliest child start to 6 px right of the latest child end, from the top of the first child's row to 6 px below the bottom of the last child's bar, 1 px border on left, right and bottom (no top border), radius 4 px, translucent background.
    Colours come from `--fg-group-frame-*` tokens. The library fallback is a neutral border and a translucent surface; hosts map the border to their own emphasized border colour (decision Q5).
- REN-34 (MUST) Group frames are drawn below bars and connectors and above row backgrounds. They are always present for expanded groups, including after any data change (the replaced chart lost them after a data reload, which was a defect).
- REN-35 (MUST) Group frames are an example of the general **layer** mechanism (section 8); the host must be able to turn the built-in group frame off (`groupFrames: false`) and draw its own.

### 5.8 Edit affordances

- REN-36 (MUST) Handles are pointer affordances only and are not in the accessibility tree; the keyboard equivalent is A11Y-9. When the chart is editable (`readOnly` false) and an item is selected or hovered, its bar shows two connection handles: small circles (about 10 px) just outside the left and right edges, vertically centred. Each handle has a hit area of at least 24 x 24 px (WCAG 2.2 target size).
- REN-37 (MUST) Handles are not shown in read-only mode or on items for which `canConnectFrom(item)` returns false.

## 6. Interactions

Pointer interactions are listed here; keyboard interactions are in section 11.

### 6.1 Selection

- INT-1 (MUST) Click on a bar or a grid row: select only that item (`onSelectionChange([id])`).
- INT-2 (MUST) Ctrl+click (Cmd+click on macOS): toggle that item in the selection.
- INT-3 (MUST) Shift+click: select the range of visible rows between the last clicked item (anchor) and this item, replacing the selection. Shift+Ctrl/Cmd+click adds the range.
- INT-4 (MUST) Selection works in read-only mode as well (a host may let users select before switching to edit mode).
- INT-5 (MUST) Right-click does not change the selection (a host's context menu acts on the clicked item; its toolbar acts on the selection).
- INT-6 (MUST) A completed click on empty timeline space or empty grid space (pointer moved less than 4 px between press and release) clears the selection. A pan or a right-click leaves the selection unchanged.
- INT-7 (MUST) Clicking a group's toggle expands or collapses it and does not change the selection.

### 6.2 Context menu

- INT-8 (MUST) Right-click (and the keyboard equivalent, A11Y-6) calls `onContextMenu(event)` with `{ target: { type: "item", item } | { type: "dependency", dependency } | { type: "empty" }, area: "grid" | "timeline", clientX, clientY, nativeEvent }`. The library does not render any menu.
- INT-9 (MUST) If the handler returns `true` (handled), the library prevents the browser's native menu. Otherwise the native menu appears. Example host configuration: handled for bars and dependencies in the timeline in both edit and read-only mode; not handled for grid rows and empty space.
- INT-10 (MUST) The library calls `onContextMenu` exactly once per gesture. (The host closes an open menu before opening a new one.)

### 6.3 Creating dependencies

- INT-11 (MUST) In edit mode, the user creates a dependency by pressing on a connection handle of the predecessor (either side; the right handle is the natural one), dragging, and releasing over the successor's bar or one of its handles. While dragging, a preview connector follows the pointer and the potential target bar is highlighted as valid or invalid.
- INT-12 (MUST) Before accepting, the library calls `canConnect({ from, to, items, dependencies })`. The drop is rejected (no callback, preview disappears) when the host returns false, when `from === to`, when the dependency already exists, or when it would create a cycle (the library checks cycles itself with `wouldCreateCycle`).
- INT-13 (MUST) On acceptance the library calls `onDependencyCreate({ from, to, type: "finish-to-start" })`. The host adds the dependency (with its own id and gap) to its data. The library does not add it by itself (controlled).
- INT-14 (MUST) Escape or releasing over empty space cancels the drag.
- INT-15 (MUST) Auto-scroll: while dragging a connector near the timeline edges, the timeline scrolls in that direction.
- INT-16 (MUST) Example host rule for `canConnect`, which the library must support: the only accepted type is finish-to-start and both items must have the same parent (both top level, or both in the same group). The example host sets the gap to 0.5 units.

### 6.4 Removing dependencies and items

- INT-17 (MUST) The library has no built-in delete gesture on pointer; removal goes through the host (context menu, toolbar). Keyboard Delete calls `onDeleteRequest` (A11Y-7).

### 6.5 Reordering rows

- INT-18 (SHOULD) In edit mode, the user can drag a grid row vertically to change its position among its siblings. A horizontal insertion marker shows where it will land. The library calls `canReorder({ item, newParentId, newIndex })` during the drag and `onReorder({ item, newParentId, newIndex })` on drop; the host updates `items`. The example host allows moves only within the same parent; the host's data stores the order. When implemented, it must also be available from the keyboard: Alt+Up and Alt+Down on a focused row move it among its siblings, with the same `canReorder` and `onReorder` calls and a live-region announcement.

### 6.6 Navigating the timeline

- INT-19 (MUST) Mouse wheel scrolls vertically; Shift+wheel and horizontal trackpad gestures scroll the timeline horizontally.
- INT-20 (MUST) Pressing anywhere in the timeline body except on a connection handle and moving the pointer more than 4 px pans the timeline horizontally and vertically, 1:1 with the pointer, in both read-only and edit mode. This includes drags that start on a bar or a connector (bars never move, NG1). Panning does not change the selection and does not start a dependency drag. A press and release without that movement is a click (INT-1, INT-6).
- INT-21 (MUST) Ctrl+wheel (Cmd+wheel on macOS, and trackpad pinch) over the timeline changes the zoom level (section 9) around the pointer position: the time under the pointer stays under the pointer.
- INT-22 (MUST) Double-click on a bar or row calls `onItemDoubleClick(item)` and does nothing else. No built-in editor exists (NG4).
- INT-23 (MUST) Touch: one-finger pan scrolls, tap selects, long press opens the context menu (`onContextMenu` with the touch position). Creating dependencies by touch MAY be unsupported in v1 (SHOULD document it).

### 6.7 Read-only mode

- INT-24 (MUST) `readOnly` (default false) disables handles, dependency creation, row reordering and `onDeleteRequest`. Selection, expansion, scrolling, panning, zoom, context menu events and double-click events stay active.
- INT-25 (MUST) Switching `readOnly` at runtime takes effect immediately without re-mounting or losing scroll position.

## 7. Grouping

Grouping is part of the data model (DATA-1); the library has no hidden grouping state. A host's grouping operations are data transforms on its own state, which the library helps with through pure helper functions (section 13.5).

- GRP-1 (MUST) Group rows, group bars, group frames and expansion as described in sections 5 and 6.
- GRP-2 (MUST) Helper `moveToGroup(state, itemIds, groupId | { newGroup: { id, label, data } })`: moves leaves into an existing or a new group (the new group is appended at the end), removes every dependency touching the moved leaves, and returns new arrays. The moved leaves keep their `data`. (A host may additionally reset job-specific settings such as a delay, which is a host concern.)
- GRP-3 (MUST) Helper `ungroup(state, groupOrLeafId)`: for a group, moves all its leaves to the top level, removes the group and every dependency touching the moved leaves; for a leaf inside a group, moves only that leaf to the top level, removes its dependencies, and removes the group if it became empty. Returns new arrays and the list of moved ids.
- GRP-4 (MUST) Helper `removeItems(state, ids)`: removes the items, the children of removed groups, and every dependency touching any removed item; removes groups that became empty because of the removal.
- GRP-5 (MUST) Helper `addItems(state, newItems, { parentId?, chain?: boolean, gap? })`: appends leaves to a parent (or top level) and, when `chain` is true, adds finish-to-start dependencies between consecutive new leaves (an "add sequentially" option).
- GRP-6 (MUST) Helpers never mutate their inputs and are deterministic given the ids the caller passes in (no hidden id generation; the caller supplies an id factory where new ids are needed).

## 8. Layers and markers

- LAYER-1 (MUST) Hosts can add custom timeline layers: `layers={[{ id, zIndex: "below-rows" | "below-bars" | "above-bars", render: (ctx) => ReactNode }]}`. `ctx` gives the computed geometry of every visible item (`left`, `top`, `width`, `height` of the bar and of the row, in timeline content coordinates), the visible window, and helpers `getItemBox(id)` and `getChildrenBoxes(groupId)`.
- LAYER-2 (MUST) Layers are re-rendered whenever layout, expansion, zoom, size or visible window change, and are virtualised by the host with the given visible window.
- LAYER-3 (MUST) The built-in group frame (REN-33) is implemented as a layer and can be disabled.
- LAYER-4 (MAY) Vertical markers (for example "now" or a deadline) can be drawn by the host with a layer; no built-in marker API is needed in v1.

## 9. Time scale and zoom

- ZOOM-1 (MUST) A zoom level is `{ id, unit: "minute" | "hour", step: number, minColumnWidth: number }`. One column covers `step` zoom units; the column width is `minColumnWidth` (default 100 px). Pixels per base unit = `minColumnWidth / (step * zoomUnitInBaseUnits)`; for example at the 1 hour level with a minute base unit one minute is 100 / 60 px. Layout results never depend on the zoom level.
- ZOOM-2 (MUST) Default levels, in order: 1 min, 5 min, 10 min, 15 min, 30 min, 1 hour. Default level: 1 min. Hosts can pass their own list.
- ZOOM-3 (MUST) Zoom is controlled (`zoomLevel` and `onZoomLevelChange`) with an uncontrolled fallback.
- ZOOM-4 (MUST) Changing the zoom changes pixels per unit; item spans stay in units (a 3-minute bar is 300 px at 1 min and 60 px at 5 min). Bars narrower than 24 px still render with a minimum visible width of 6 px and keep their accessible name.
- ZOOM-5 (MUST) `showTimeScale` (default true; the example host configuration sets false). When shown, the header displays one label per column, formatted by `formatScaleLabel(date, level)` with a sensible default (`HH:mm` for minute levels, `HH:00` for hour levels, using the browser locale for day boundaries).
- ZOOM-6 (MUST) `origin` changes (for example from a "Start date" picker in the host) shift every item without changing relative positions and keep the current scroll position relative to the origin.

## 10. Theming

The library ships one CSS file. All colours, borders, radii, fonts and the selection ring come from CSS custom properties with neutral fallback values, so the library works without any design system. Hosts set the properties on the chart root or any ancestor.

- THEME-1 (MUST) Supported custom properties (the `--fg-` prefix is a working name):

| Property | Purpose |
| --- | --- |
| `--fg-font-family` | All text |
| `--fg-font-size` | Bar and cell text (default 13 px) |
| `--fg-text-color` | Default text |
| `--fg-surface` | Chart background |
| `--fg-border-color` | Outer border, header border, row separators |
| `--fg-grid-line-color` | Timeline column lines |
| `--fg-header-bg`, `--fg-header-text-color` | Header strip |
| `--fg-row-bg`, `--fg-row-alt-bg` | Grid striping (REN-27) |
| `--fg-group-row-bg` | Group row in grid |
| `--fg-group-divider-color` | Group block borders (REN-28/29) |
| `--fg-row-selected-bg`, `--fg-group-row-selected-bg` | Selection |
| `--fg-row-error-bg`, `--fg-group-row-error-bg`, `--fg-timeline-row-error-bg` | Error status |
| `--fg-timeline-row-bg` | Timeline rows |
| `--fg-toggle-bg`, `--fg-toggle-icon-color` | Expand/collapse toggle |
| `--fg-bar-radius` | Bar corners |
| `--fg-bar-default-bg`, `-border`, `-text` | Variant `default` |
| `--fg-bar-dependent-bg`, `-border`, `-text` | Variant `dependent` |
| `--fg-bar-delayed-bg`, `-border`, `-text` | Variant `delayed` |
| `--fg-bar-group-text` | Variant `group` label |
| `--fg-bar-selected-ring` | Selected bar glow |
| `--fg-group-frame-border`, `--fg-group-frame-bg`, `--fg-group-frame-header-bg` | Group frames |
| `--fg-link-color`, `--fg-link-selected-color`, `--fg-link-invalid-color` | Connectors |
| `--fg-handle-bg`, `--fg-handle-border` | Connection handles |
| `--fg-drop-valid-color`, `--fg-drop-invalid-color` | Dependency drag feedback |
| `--fg-focus-ring` | Keyboard focus |
| `--fg-status-<status>-bg`, `-border`, `-text` for `warning`, `success`, `running`, `pending`, `skipped` | Run status styling (X-5) |
| `--fg-dim-opacity` | Opacity of items outside a highlight (X-1, X-2, X-8), default 0.35 |
| `--fg-path-color` | Longest-path emphasis for bars and connectors (X-2) |
| `--fg-preview-bg`, `--fg-preview-border` | Ghost bars during dependency preview (X-7) |
| `--fg-flash-color` | Flash after `flashItem` (X-3) |
| `--fg-reorder-marker-color` | Row reorder marker |

- THEME-2 (MUST) No colour is hard-coded outside the fallback values of these properties. Light and dark themes work by changing the properties only.
- THEME-3 (MUST) Library selectors have zero specificity (wrapped in `:where()`) and use a single prefixed class namespace (`fg-`), so any host rule wins without `!important`.
- THEME-4 (MUST) Stable styling hooks are documented data attributes on rows and bars: `data-kind` (`group`/`leaf`), `data-variant`, `data-selected`, `data-status`, `data-collapsed`, `data-level`. Internal class names other than the root class are not part of the public API.
- THEME-5 (MUST) Sizes that affect layout (row height, bar height, header height, grid width, column width) are props, not CSS properties, because the layout math needs them.
- THEME-6 (MUST) Animations (hover, selection, drag preview) use durations from `--fg-motion-duration` (default 150 ms) and are disabled under `prefers-reduced-motion: reduce`.

## 11. Accessibility and keyboard

The replaced chart had a treegrid role on the grid but no keyboard navigation, no focusable rows, and bars with empty accessible names. Flow Gantt must do better.

- A11Y-1 (MUST) The grid pane is a WAI-ARIA `treegrid`. Rows have `aria-level`, `aria-setsize`, `aria-posinset`, `aria-selected`, and groups have `aria-expanded`. The tree uses a roving `tabindex`: the chart is one Tab stop; arrow keys move inside it.
- A11Y-2 (MUST) Keys when a row has focus:
  - Up/Down: previous/next visible row; Home/End: first/last row; Page Up/Page Down: one page.
  - Right: expand a collapsed group, or move to its first child; Left: collapse an expanded group, or move from a child to its group.
  - Space: select only the focused row; Ctrl/Cmd+Space: toggle the focused row in the selection; Shift+Up/Down: extend the selection; Ctrl/Cmd+A: select all visible rows.
  - Enter: calls `onItemActivate(item)` (a host may treat it like a double-click, for example to open a details drawer).
  - Escape: clears the selection, or cancels an active dependency drag or keyboard linking.
- A11Y-3 (MUST) Focus is visible on the focused row in both panes (2 px ring in `--fg-focus-ring`), and the timeline scrolls so the focused item's bar is visible.
- A11Y-4 (MUST) Each row's accessible name is the item's label (or `getAccessibleLabel(item)` when given). Truncated text is fully available to assistive technology.
- A11Y-5 (MUST) Each row has an accessible description listing its predecessors and successors by label ("Starts after: Login. Followed by: none.") and the host's status text (A11Y-8). The timeline bars are presentational duplicates (`aria-hidden`) of the rows; there is one accessible object per item.
- A11Y-6 (MUST) The context-menu key and Shift+F10 on a focused row call `onContextMenu` with `target` the focused item and the position of the row's bar (or of the row when the bar is off-screen).
- A11Y-7 (MUST) Delete and Backspace on a focused row in edit mode call `onDeleteRequest(selectedIds or [focusedId])`. The library deletes nothing itself.
- A11Y-8 (MUST) Items with status `error` expose it in their accessible description (text supplied by the host through `getStatusText(item)`; default "Has errors").
- A11Y-9 (MUST) Keyboard dependency creation: in edit mode, pressing `D` on a focused row, or calling `api.beginDependency(fromId)` (for example from a host menu item), enters linking mode. The `D` shortcut is active only while focus is inside the chart (WCAG 2.1.4) and can be turned off with `keyboardShortcuts={{ beginDependency: false }}`. In linking mode arrow keys choose the target row, Enter confirms (same validation as INT-12), Escape cancels. A live region announces the start, each candidate ("Connect to Check stock, allowed" or "not allowed"), and the result.
- A11Y-10 (MUST) Changes announced in a polite live region: selection count after a range or select-all, expansion of a group, dependency created or rejected.
- A11Y-11 (MUST) Colour is never the only carrier of meaning: variants and states that matter (dependent, delayed, error, selected) also have a text or icon equivalent in the accessible description, and the error and selected styles differ in more than hue (ring, border weight).
- A11Y-12 (MUST) Default token values give at least 4.5:1 contrast for bar text and 3:1 for connectors, handles and focus rings against their backgrounds.
- A11Y-13 (MUST) Interactive targets (toggle, handles, connector hit areas) are at least 24 x 24 px.
- A11Y-14 (MUST) The chart has an accessible name (`aria-label` prop; for example the name of the host's flow, or "Flow chart").

## 12. Events and callbacks for the host

All callbacks are optional. Each receives plain objects; items and dependencies are the same object references the host passed in.

| Callback | When |
| --- | --- |
| `onSelectionChange(ids, { source: "pointer" \| "keyboard" \| "api" })` | Selection changed by the user |
| `onCollapsedChange(ids)` | Group expanded or collapsed |
| `onContextMenu(event) => boolean` | INT-8 |
| `onDependencyCreate({ from, to, type })` | INT-13 |
| `canConnect(ctx) => boolean` | INT-12 |
| `canConnectFrom(item) => boolean` | REN-37 |
| `onReorder(change)` and `canReorder(change) => boolean` | INT-18 |
| `onItemDoubleClick(item)`, `onItemActivate(item)` | INT-22, A11Y-2 |
| `onDeleteRequest(ids)` | A11Y-7 |
| `onZoomLevelChange(levelId)` | ZOOM-3 |
| `onLayoutChange(layout)` | After every layout computation, with the same result as `computeLayout` |
| `onScroll({ left, top })` | Scroll or pan |
| `onDataError(errors)` | DATA-1, 6, 7, 9 |

- EVT-1 (MUST) Callbacks fire after the user action and never during render.
- EVT-2 (MUST) No user-action callback fires as a reaction to prop changes made by the host (for example, passing a new `selectedIds` does not call `onSelectionChange`). The diagnostic callbacks `onLayoutChange` and `onDataError` are the exception: they fire after the commit in which a recomputation happened, whatever caused it, never during render, and only when their result differs from the previous call.
- EVT-3 (MUST) Callbacks are read from the latest props; the host does not need to memoise them.

## 13. Proposed public API

### 13.1 Package shape

- One ESM package with TypeScript declarations, `sideEffects` limited to the CSS file, React 18.3 and 19 as peer dependency, no other runtime dependencies.
- Entry points: `.` (component and types), `./layout` (pure layout and graph helpers, no React import), `./ops` (pure data helpers from section 7), `./styles.css`.

### 13.2 Component

```tsx
import type { CSSProperties, ReactElement, ReactNode, Ref } from "react";

export interface FlowGanttProps<TData = unknown> {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
  origin: Date;

  // layout and sizes
  baseUnit?: "minute" | "hour"; // "minute"
  defaultSpan?: number; // 3, in base units
  dependencyGap?: number; // 0.5, in base units
  initialSize?: { width: number; height: number }; // { width: 1024, height: 600 }, used when the container cannot be measured
  zoomLevels?: readonly ZoomLevel[];
  zoomLevel?: string; // controlled
  defaultZoomLevel?: string; // uncontrolled, default "1min"
  onZoomLevelChange?: (levelId: string) => void;
  rowHeight?: number; // 36
  barHeight?: number; // rowHeight - 5
  headerHeight?: number; // 35
  gridWidth?: number; // 360
  resizableGrid?: boolean; // false
  showTimeScale?: boolean; // true
  formatScaleLabel?: (date: Date, level: ZoomLevel) => string;

  // grid
  columns: readonly FlowColumn<TData>[];

  // bars and appearance
  renderBar?: (item: FlowItem<TData>, ctx: BarRenderContext) => ReactNode;
  getBarVariant?: (
    item: FlowItem<TData>,
    ctx: { predecessors: readonly FlowItem<TData>[] },
  ) => string;
  getItemStatus?: (item: FlowItem<TData>) => ItemStatus | undefined;
  getStatusText?: (item: FlowItem<TData>) => string;
  getAccessibleLabel?: (item: FlowItem<TData>) => string;
  groupFrames?: boolean; // true
  chainHighlight?: "none" | "direct" | "full"; // "full" (X-1)
  highlightLongestPath?: boolean; // false (X-2)
  highlightedIds?: readonly ItemId[]; // dims every other item when non-empty (X-8)
  stickyGroupHeaders?: boolean; // true (X-4)
  animateLayout?: boolean; // true (X-6)
  previewDependencyLayout?: boolean; // true (X-7)
  fitOnLoad?: boolean; // false (X-3)
  linkEndMarker?: "dot" | "arrow"; // "dot"
  layers?: readonly FlowLayer<TData>[];

  // state
  selectedIds?: readonly ItemId[];
  defaultSelectedIds?: readonly ItemId[];
  onSelectionChange?: (ids: ItemId[], info: { source: "pointer" | "keyboard" | "api" }) => void;
  collapsedIds?: readonly ItemId[];
  defaultCollapsedIds?: readonly ItemId[];
  onCollapsedChange?: (ids: ItemId[]) => void;

  // editing
  readOnly?: boolean; // false
  canConnectFrom?: (item: FlowItem<TData>) => boolean;
  canConnect?: (ctx: ConnectContext<TData>) => boolean;
  onDependencyCreate?: (draft: { from: ItemId; to: ItemId; type: "finish-to-start" }) => void;
  canReorder?: (change: ReorderChange<TData>) => boolean;
  onReorder?: (change: ReorderChange<TData>) => void;
  onDeleteRequest?: (ids: ItemId[]) => void;

  // events
  onContextMenu?: (event: FlowContextMenuEvent<TData>) => boolean | void;
  onItemDoubleClick?: (item: FlowItem<TData>) => void;
  onItemActivate?: (item: FlowItem<TData>) => void;
  onLayoutChange?: (layout: FlowLayout) => void;
  onScroll?: (pos: { left: number; top: number }) => void;
  onDataError?: (errors: FlowDataError[]) => void;

  // text and keyboard
  messages?: Partial<FlowMessages>;
  keyboardShortcuts?: { beginDependency?: boolean; reorder?: boolean };

  // host element
  "aria-label"?: string;
  className?: string;
  style?: CSSProperties;
}

export interface FlowColumn<TData = unknown> {
  id: string;
  header: ReactNode;
  width?: number | "fill"; // "fill" shares the remaining grid width
  tree?: boolean; // shows indentation and the toggle; exactly one column
  render?: (item: FlowItem<TData>) => ReactNode; // default: item.label as text
}

export interface ZoomLevel {
  id: string;
  unit: "minute" | "hour";
  step: number;
  minColumnWidth: number;
  label?: string;
}

export interface BarRenderContext {
  width: number;
  height: number;
  selected: boolean;
  variant: string;
  status?: "error";
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
  newIndex: number; // index among the new parent's children after the move
}

export type FlowContextMenuEvent<TData = unknown> = {
  target:
    | { type: "item"; item: FlowItem<TData> }
    | { type: "dependency"; dependency: FlowDependency }
    | { type: "empty" };
  area: "grid" | "timeline";
  clientX: number;
  clientY: number;
  nativeEvent: MouseEvent | KeyboardEvent | TouchEvent;
};

export interface FlowLayer<TData = unknown> {
  id: string;
  zIndex: "below-rows" | "below-bars" | "above-bars";
  render: (ctx: LayerContext<TData>) => ReactNode;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LayerContext<TData = unknown> {
  visibleWindow: Box; // in timeline content coordinates
  visibleItems: readonly { item: FlowItem<TData>; bar: Box; row: Box }[];
  getItemBox: (id: ItemId) => { bar: Box; row: Box } | null; // null when hidden (collapsed)
  getChildrenBoxes: (groupId: ItemId) => readonly { item: FlowItem<TData>; bar: Box; row: Box }[];
}

export type FlowDataError =
  | { code: "duplicate-id" | "unknown-parent" | "invalid-parent" | "nested-group"; itemId: ItemId }
  | {
      code: "unknown-endpoint" | "self-dependency" | "unsupported-type" | "cycle";
      dependencyId: string;
    }
  | { code: "unsupported-field"; itemId: ItemId; field: string }
  | { code: "invalid-origin" | "invalid-option" | "extent-too-large"; detail: string }
  | { code: "invalid-number"; itemId?: ItemId; dependencyId?: string; field: string };

export type ItemStatus = "error" | "warning" | "success" | "running" | "pending" | "skipped";

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
}

export declare function FlowGantt<TData = unknown>(
  props: FlowGanttProps<TData> & { ref?: Ref<FlowGanttHandle> },
): ReactElement;
```

### 13.3 Imperative handle

```ts
export interface FlowGanttHandle {
  scrollToItem(
    id: ItemId,
    options?: { align?: "start" | "center" | "nearest"; behavior?: ScrollBehavior },
  ): void;
  scrollTo(pos: { left?: number; top?: number }): void;
  getScroll(): { left: number; top: number };
  getItemBox(id: ItemId): { bar: Box; row: Box } | null; // timeline content coordinates
  focusItem(id: ItemId): void;
  beginDependency(fromId: ItemId): void; // A11Y-9
  cancelInteraction(): void; // ends any drag or linking mode
  fitToView(options?: { ids?: readonly ItemId[] }): void; // X-3
  flashItem(id: ItemId): void; // X-3, short highlight after scrolling to it
}
```

- API-1 (MUST) `scrollToItem` expands nothing; if the item is inside a collapsed group the host must expand it first (the call is a no-op and returns without error).
- API-2 (MUST) A typical host "Show" action (scroll to newly added or moved items and select them) is: `onSelectionChange` is not involved; the host sets `selectedIds` and calls `scrollToItem(firstId, { align: "start" })`.

### 13.4 Layout and graph helpers (`./layout`)

```ts
export interface FlowLayoutEntry {
  id: ItemId;
  startUnits: number;
  endUnits: number;
  start: Date;
  end: Date;
}
export interface FlowLayout {
  entries: ReadonlyMap<ItemId, FlowLayoutEntry>;
  minUnits: number; // always 0 (the origin)
  maxUnits: number; // latest end
  errors: readonly FlowDataError[];
  longestPath: readonly ItemId[]; // X-2, in order from first to last item
}

export declare function computeLayout<TData>(input: {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
  origin: Date;
  baseUnit?: "minute" | "hour"; // "minute"
  defaultSpan?: number;
  dependencyGap?: number;
}): FlowLayout;

export declare function wouldCreateCycle(
  dependencies: readonly FlowDependency[],
  from: ItemId,
  to: ItemId,
): boolean;
export declare function getPredecessors(
  dependencies: readonly FlowDependency[],
  id: ItemId,
): ItemId[];
export declare function getSuccessors(
  dependencies: readonly FlowDependency[],
  id: ItemId,
): ItemId[];
export declare function validate<TData>(
  items: readonly FlowItem<TData>[],
  dependencies: readonly FlowDependency[],
): FlowDataError[];
```

### 13.5 Data helpers (`./ops`)

```ts
export interface FlowState<TData = unknown> {
  items: readonly FlowItem<TData>[];
  dependencies: readonly FlowDependency[];
}

export declare function addItems<TData>(
  state: FlowState<TData>,
  newItems: readonly FlowItem<TData>[],
  options: {
    parentId?: ItemId | null;
    chain?: boolean;
    gap?: number;
    newDependencyId: () => string;
  },
): FlowState<TData>;
export declare function removeItems<TData>(
  state: FlowState<TData>,
  ids: readonly ItemId[],
): FlowState<TData>;
export declare function moveToGroup<TData>(
  state: FlowState<TData>,
  leafIds: readonly ItemId[],
  target: { groupId: ItemId } | { newGroup: FlowItem<TData> },
): FlowState<TData>;
export declare function ungroup<TData>(
  state: FlowState<TData>,
  id: ItemId,
): { state: FlowState<TData>; movedIds: ItemId[] };
export declare function removeDependency<TData>(
  state: FlowState<TData>,
  dependencyId: string,
): FlowState<TData>;
export declare function reorder<TData>(
  state: FlowState<TData>,
  change: { itemId: ItemId; newParentId: ItemId | null; newIndex: number },
): FlowState<TData>;
```

## 14. Performance

Reference data set: 60 groups, 540 leaves, 600 rows, about 400 dependencies. Reference machine: a mid-range laptop (4 performance cores, integrated GPU), Chrome stable, 1600 x 900 viewport, production build.


- PERF-1 (MUST) Rendering is virtualised in both directions: only rows in the visible window plus an overscan (default 5 rows) are in the DOM; bars, connectors and layer content outside the visible horizontal window plus one screen of overscan are not rendered. DOM node count in the chart stays under 1,500 at the reference viewport for any data size.
- PERF-2 (MUST) `computeLayout` for 5,000 items and 5,000 dependencies completes in under 20 ms on the reference machine.
- PERF-3 (MUST) First render (layout plus DOM) of the reference data set completes in under 100 ms after the data is available; for 5,000 items and 5,000 dependencies in under 400 ms.
- PERF-4 (MUST) Scrolling and panning keep 60 frames per second on the reference data set and at 5,000 rows: scripting per frame at most 6 ms median and 10 ms at the 95th percentile.
- PERF-5 (MUST) Changing one item, one dependency, the selection or the expansion state re-renders in under 16 ms on the reference data set (no full rebuild of off-screen structures).
- PERF-6 (MUST) Mounting and unmounting the component 100 times leaves no detached DOM nodes, event listeners or observers behind.
- PERF-7 (SHOULD) JavaScript bundle size at most 40 kB minified and gzipped; CSS at most 8 kB.
- PERF-8 (MUST) No layout thrashing: the library measures the container size through `ResizeObserver` and never reads layout properties of individual rows or bars during scrolling.

## 15. Platform, compatibility and security

- PLAT-1 (MUST) Browsers: the last two stable versions of Chrome, Edge, Firefox and Safari on desktop; iPadOS Safari for touch (INT-23).
- PLAT-2 (MUST) React 18.3 and React 19. Works in StrictMode (double effects) and with concurrent rendering.
- PLAT-3 (MUST) Server-side rendering safe: importing the package and rendering the component on a server does not access `window` or `document`; the client renders the full chart after mounting.
- PLAT-4 (MUST) Testable in jsdom: when `ResizeObserver` or layout sizes are unavailable, the component renders using the `initialSize` prop (default `{ width: 1024, height: 600 }`) so unit tests can find rows and bars.
- PLAT-5 (MUST) Several instances on one page work independently (no global singletons, unique ids per instance).
- PLAT-6 (MUST) No network requests, no `eval` or `new Function`, no `dangerouslySetInnerHTML` with host data, no inline `<style>` injection at runtime (works under a Content Security Policy without `unsafe-inline` for styles, apart from React's own style property assignments, which CSP does not block).
- SEC-1 (MUST) All host strings (labels, status text, accessible labels, messages) are rendered as React text. The library has no API that accepts HTML strings, never uses `dangerouslySetInnerHTML`, never builds markup from strings, and never turns host data into URLs, `href`, `src` or event handlers. React nodes returned by host render functions (`renderBar`, column `render`, layers) are trusted by contract: the host is responsible for their content, and the documentation says so.
- SEC-3 (MUST) Before this repository becomes public: add the MIT license, remove host-specific material (or move it to the host's private repository), replace host examples with synthetic ones where they reveal internal details, and record a clean-room and disclosure review.
- SEC-4 (MUST) Release hygiene: zero runtime dependencies besides the React peer dependency; every dev dependency has an OSI-approved license (checked in CI); the lockfile is committed and reviewed on change; `npm pack --dry-run` output is inspected before each publish so only `dist`, types, CSS, README and LICENSE ship; packages are published with npm provenance from CI.
- SEC-2 (MUST) Data errors never throw during render; they are reported (DATA-1) and the rest of the chart renders.
- I18N-1 (MUST) The library has no built-in user-visible text except accessibility strings, which are all overridable through the `messages` prop (`Partial<FlowMessages>`, English defaults exported as `defaultMessages`). Message values are plain strings or functions returning plain strings. Right-to-left layout is not required in v1.

## 16. Acceptance tests

Each test names the requirements it covers. Unless stated, use the "reference example" data set: groups Setup (Login; Check stock after Login, delay 10 s), Sales flow after Setup (Create sales order; Post invoice after Create sales order, repeated 3 times in parallel), top-level leaf Run MRP (delay 1 min), group Month end after Sales flow and Run MRP (Export report; Close period after Export report; Send summary mail after Close period, repeated twice sequentially); origin 2026-11-20 09:00 local time; defaults from LAY-1, REN-\*, ZOOM-2.

Layout (pure, no DOM):

1. AT-L1 `computeLayout` on the reference example returns: Setup 0-6.5, Login 0-3, Check stock 3.5-6.5, Sales flow 7-13.5, Create sales order 7-10, Post invoice 10.5-13.5, Run MRP 0-3, Month end 14-24, Export report 14-17, Close period 17.5-20.5, Send summary mail 21-24 (units). (LAY-1 to LAY-7)
2. AT-L2 Removing the dependency Login to Check stock moves Check stock to 0-3 and Setup to 0-3, and Sales flow to 3.5-10 (no stale positions). (LAY-8)
3. AT-L3 Removing Login (and its dependencies) gives the same layout as AT-L2. (LAY-8, GRP-4)
4. AT-L4 With items A then B in display order and dependencies A to B and B to A, the dependency B to A is reported once with code `cycle`; layout places A at 0-3 and B at 3.5-6.5. (DATA-9)
5. AT-L5 Dependencies to unknown ids, self dependencies and unsupported types are reported and ignored. (DATA-6, DATA-7)
6. AT-L6 Duplicate dependencies count once. (DATA-8)
7. AT-L7 An empty group is placed at its computed start with span `defaultSpan`. (LAY-5)
8. AT-L8 Changing the origin by +30 minutes shifts every `start` and `end` Date by 30 minutes and leaves units unchanged. (ZOOM-6)
9. AT-L9 5,000 items and 5,000 dependencies (random DAG, fixed seed) lay out in under 20 ms (performance test, reference machine). (PERF-2)

Data helpers:

10. AT-O1 `ungroup` on a group with two linked leaves moves both to top level, removes the group and the dependency between them, and keeps each leaf's `data` unchanged. (GRP-3)
11. AT-O2 `ungroup` on one leaf of a group moves only that leaf, removes its dependencies, keeps the group with the other leaf. (GRP-3)
12. AT-O3 `ungroup` on the last leaf of a group removes the group. (GRP-3)
13. AT-O4 `moveToGroup` into an existing group appends the leaves to it and removes their dependencies. (GRP-2)
14. AT-O5 `moveToGroup` with a new group appends a new group at the end and moves the leaves into it. (GRP-2)
15. AT-O6 `addItems` without parent appends top-level leaves; with a parent appends children; with `chain: true` adds dependencies between consecutive new leaves only. (GRP-5)
16. AT-O7 `removeItems` on the only child of a group removes the group too. (GRP-4)
17. AT-O8 No helper mutates its input (frozen inputs in tests). (GRP-6)

Rendering (DOM, jsdom or browser):

18. AT-R1 Grid shows rows in the order Setup, Login, Check stock, Sales flow, Create sales order, Post invoice, Run MRP, Month end, Export report, Close period, Send summary mail. (DATA-2, REN-5)
19. AT-R2 With 100 px columns at 1 min: Login's bar is 300 px wide and starts 100 px from the timeline's left edge; Check stock starts 50 px after Login ends; Setup's bar is 650 px wide. (REN-9, REN-15, ZOOM-1)
20. AT-R3 Rows are 36 px high, bars 31 px, bars are vertically centred. (REN-5, REN-15)
21. AT-R4 The timeline is 27 columns wide for the reference example. (REN-9)
22. AT-R5 Grid striping: Login uses the alternate colour, Check stock the base colour, Run MRP the alternate colour, Export report alternate, Close period base, Send summary mail alternate. (REN-27)
23. AT-R6 Group rows have the group background, bold text and a top divider; Check stock, Post invoice and Send summary mail have a bottom divider. (REN-28, REN-29)
24. AT-R7 With the example host's `getBarVariant` (REN-18), Login and Create sales order are `default`, Check stock and Run MRP are `delayed`, Post invoice, Close period and Send summary mail are `dependent`, groups are `group`. (REN-18)
25. AT-R8 Group frames: Setup has a header frame and a body frame enclosing Login and Check stock with 6 px horizontal outset; collapsing Setup removes its frames; re-expanding shows them; replacing `items` with a new array of the same content keeps them. (REN-33, REN-34)
26. AT-R9 Seven connectors exist for the reference example (Login to Check stock, Create sales order to Post invoice, Setup to Sales flow, Sales flow to Month end, Run MRP to Month end, Export report to Close period, Close period to Send summary mail); with a viewport wide enough for the whole timeline all seven are drawn, each with a right stub, a vertical segment and a horizontal segment ending in an 8 px dot at the target's left edge. With `gap: -2` on one dependency, that connector uses the backward route of REN-22 and none of its segments intersects the source or target bar. (REN-20 to REN-23)
27. AT-R10 Collapsing Month end hides its child rows and the connectors between its children but keeps the connectors into Month end; Month end's bar keeps its 1,000 px width. (REN-17, REN-25, LAY-9)
28. AT-R11 A label containing `<img src=x onerror=alert(1)>` renders as literal text in the grid and on the bar, and no image element is created. (SEC-1, DATA-3)
29. AT-R12 `getItemStatus` returning `error` for Setup and Check stock colours both grid rows and timeline rows with the error tokens, and the selection ring stays visible on a selected error bar. (REN-32, DATA-14)
30. AT-R13 Setting every `--fg-*` property on the root changes the corresponding rendered colours; no computed colour inside the chart comes from a value other than these properties or the host's own content. (THEME-1, THEME-2)
31. AT-R14 A host rule with a single class selector overrides the library's bar background without `!important`. (THEME-3)

Interaction:

32. AT-I1 Click on Login's bar selects only Login; Ctrl+click on Run MRP's grid row adds it; both grid rows and timeline rows show the selected background and both bars the selection ring. Works with `readOnly`. (INT-1, INT-2, INT-4, REN-31)
33. AT-I2 Click on Login, then Shift+click on Post invoice selects the five visible rows from Login to Post invoice inclusive (Login, Check stock, Sales flow, Create sales order, Post invoice). (INT-3)
34. AT-I3 Right-click on a selected bar keeps the selection unchanged and calls `onContextMenu` once with `target.type === "item"`, `area === "timeline"`. (INT-5, INT-8, INT-10)
35. AT-I4 Right-click on a connector calls `onContextMenu` with `target.type === "dependency"`; right-click on empty timeline space with `target.type === "empty"`; when the handler returns true the native event's default is prevented, otherwise not. (INT-8, INT-9, REN-24)
36. AT-I5 In edit mode, dragging from Export report's right handle to Send summary mail's bar calls `canConnect` and then `onDependencyCreate({ from: Export report, to: Send summary mail })`. (INT-11 to INT-13)
37. AT-I6 Dragging from Login's right handle to Run MRP's bar with the example host's `canConnect` (INT-16, different parents) creates nothing and shows the invalid drop feedback while hovering. (INT-12, INT-16)
38. AT-I7 Dragging from Send summary mail to Export report (would create a cycle) creates nothing even when `canConnect` returns true. (INT-12)
39. AT-I8 In read-only mode no handles are rendered, and a drag that starts on a bar pans the timeline instead of linking; in edit mode a drag that starts on a bar (not on a handle) also pans. (REN-37, INT-20, INT-24)
40. AT-I9 Pressing on empty timeline background and dragging 250 px to the left scrolls the timeline 250 px to the right and does not change the selection. (INT-20)
41. AT-I10 Ctrl+wheel over the timeline moves through the zoom levels in order and keeps the time under the pointer fixed within one column width; Login's bar is 60 px wide at the 5 min level. (INT-21, ZOOM-2, ZOOM-4)
42. AT-I11 Clicking a group toggle collapses and expands it, calls `onCollapsedChange`, and does not change the selection. (INT-7, DATA-12)
43. AT-I12 Double-click on a bar calls `onItemDoubleClick` and opens nothing. (INT-22)
44. AT-I13 In edit mode, dragging Post invoice's grid row above Create sales order calls `canReorder` and `onReorder({ newParentId: Sales flow, newIndex: 0 })`; dragging Check stock into Month end is refused when `canReorder` returns false (example host rule). (INT-18)
45. AT-I14 Switching `readOnly` from true to false while scrolled keeps the scroll position and shows handles on the selected bars. (INT-25, REN-36)
46. AT-I15 `scrollToItem(Send summary mail, { align: "start" })` scrolls both directions so the bar's top-left corner is visible. (API-2)

Accessibility:

47. AT-A1 The grid exposes a treegrid with correct `aria-level`, `aria-setsize`, `aria-posinset`, `aria-expanded` and `aria-selected` values for the reference example (axe-core reports no violations). (A11Y-1, A11Y-14)
48. AT-A2 Tab moves focus into the chart once; arrow keys, Home, End, Page Up and Page Down move as specified; Left and Right collapse and expand Setup. (A11Y-1, A11Y-2)
49. AT-A3 Space, Ctrl+Space and Shift+Down change the selection as specified and announce the selection count. (A11Y-2, A11Y-10)
50. AT-A4 Check stock's accessible description contains "Starts after: Login". (A11Y-5)
51. AT-A5 Shift+F10 on a focused row calls `onContextMenu` with that item; Delete in edit mode calls `onDeleteRequest` with the selection; Delete in read-only mode does nothing. (A11Y-6, A11Y-7)
52. AT-A6 Default tokens meet the contrast ratios of A11Y-12 (automated contrast check on rendered colours). (A11Y-12)
53. AT-A7 With `prefers-reduced-motion: reduce` no transition longer than 0 ms is applied. (THEME-6)

Performance and platform:

54. AT-P1 With the 600-row reference data set: first render under 100 ms, scrolling at 60 fps with scripting per frame within PERF-4, chart DOM nodes under 1,500. (PERF-1, PERF-3, PERF-4)
55. AT-P2 With 5,000 rows and 5,000 dependencies: first render under 400 ms, scrolling within PERF-4. (PERF-3, PERF-4)
56. AT-P3 100 mount and unmount cycles leave no detached nodes or listeners (heap snapshot comparison). (PERF-6)
57. AT-P4 The component renders under `renderToString` without errors and hydrates on the client. (PLAT-3)
58. AT-P5 The component renders in jsdom with `initialSize` and the AT-R1 rows are queryable by role. (PLAT-4)
59. AT-P6 Two charts on one page keep separate selection, scroll and zoom. (PLAT-5)


Beyond parity (section 18):

63. AT-X1 Hovering Check stock with `chainHighlight: "full"` keeps Login, Check stock, Setup and every item downstream of Check stock (Sales flow and its children, Month end and its children) at full opacity together with the connectors between them, and dims all other items to `--fg-dim-opacity`; with `"direct"` only Login and Check stock stay; with `"none"` nothing dims. Keyboard focus produces the same highlight. (X-1)
64. AT-X2 `computeLayout(...).longestPath` for the reference example is Login, Check stock, Create sales order, Post invoice, Export report, Close period, Send summary mail; with `highlightLongestPath` those bars and the connectors between them use `--fg-path-color`. Ties resolve to the first item in display order. (X-2)
65. AT-X3 `fitToView()` picks the most detailed zoom level at which the whole timeline fits the visible width (or the coarsest level when none fits) and scrolls to the start; `fitToView({ ids: [postInvoiceId] })` does the same for that item; `flashItem` applies a highlight for about 1 s that is skipped under reduced motion. (X-3)
66. AT-X4 Scrolling down inside Month end's children keeps the Month end row pinned under the header in the grid until its last child scrolls out; the pinned copy is not exposed to assistive technology. (X-4)
67. AT-X5 Each status value renders its own tokens and appears in the accessible description; `running` shows a moving stripe that becomes static under reduced motion. (X-5)
68. AT-X6 Removing the dependency Login to Check stock animates Check stock and the following items to their new positions within `--fg-motion-duration`; with reduced motion or more than 500 moving bars they jump immediately; the final positions equal AT-L2. (X-6)
69. AT-X7 While dragging a new dependency from Run MRP to Sales flow (with a permissive `canConnect`), ghost bars show Sales flow and every affected item at the positions `computeLayout` would return with the new dependency; releasing over empty space removes the ghosts and changes nothing. (X-7)
70. AT-X8 With `highlightedIds` set to Post invoice and Close period only those two bars and rows stay at full opacity; an empty array dims nothing. (X-8)
71. AT-X9 Under a strict Content Security Policy (`default-src 'self'; style-src 'self'; script-src 'self'`) in a real browser, the chart renders, selects, pans and creates dependencies with no CSP violation reported. (PLAT-6, SEC-1)

## 17. Decisions on the open questions

Settled on 2026-11-16 by the spec author together with an independent Codex review, at the owner's request (the owner asked not to be consulted).

- Q1 Name: Flow Gantt, repository `SychPL/flow-gantt`, npm `@sychpl/flow-gantt` (verify control of the npm scope before the first publish), prefixes `--fg-` and `fg-`, MIT license added before the repository becomes public (SEC-3).
- Q2 Time axis: hidden in the example host configuration for v1; delays and repeats stay badges and never affect layout in v1. A future scheduling view may revisit this.
- Q3 Items with a fixed start time: no pinned items in v1 (LAY-11 stays reserved). A host adapter keeps such items unchanged, shows them with a badge, and makes them dependency-driven only when the user adds a dependency to them.
- Q4 Stale positions: LAY-8 removes the cause, so a host needs no stale-position warning or re-layout action; normal save validation and `getItemStatus` stay.
- Q5 Group frame colour: neutral; hosts map `--fg-group-frame-border` to their own emphasized border colour.
- Q6 Row reordering: stays SHOULD for v1 (INT-18) with a keyboard method when implemented; order is always preserved in data and saves.
- Q7 Click on empty space: clears the selection (INT-6 is MUST).
- Q8 Touch: scrolling, tap to select and long press for the context menu only; touch dependency creation is documented as unavailable.
- Q9 Scope: depth 2 and finish-to-start only for the first release.
- Q10 Performance ownership: the flow-gantt repository runs performance checks on every pull request to catch regressions (layout benchmark and a browser rendering and scrolling test) and runs reproducible reference-machine measurements for all PERF requirements before each release; CI numbers alone do not prove the PERF thresholds.

## 18. Beyond parity (v1 extras)

Features the replaced library did not offer. All are SHOULD for v1; acceptance tests AT-X1 to AT-X9 cover them. They follow the same accessibility, theming, performance and security rules as the rest of the spec.

- X-1 (SHOULD) Dependency chain highlight. Hovering a bar or row, or focusing a row, highlights the item, its predecessors and successors and the connectors between them, and dims everything else to `--fg-dim-opacity`. `chainHighlight` selects `"full"` (every item reachable backwards and forwards along the combined layout graph of DATA-9, so a group is upstream of its children and downstream of its children's ends; siblings that are not connected stay dimmed unless reached that way), `"direct"` (only direct neighbours) or `"none"`. The accessible description already lists direct neighbours (A11Y-5), so there is no extra announcement.
- X-2 (SHOULD) Longest path. `computeLayout` returns `longestPath`: the chain of leaves that determines the latest end of the chart. Start from the leaf with the latest end; repeatedly step to the predecessor (explicit dependency, or through the enclosing group's predecessor when the leaf starts at its group's start) whose end plus gap equals the current item's start; when a group is reached, continue from its child with the latest end. Ties go to the first item in display order. `highlightLongestPath` draws those bars and connectors with `--fg-path-color` and adds "On the longest path" to their accessible description.
- X-3 (SHOULD) Fit and reveal. `api.fitToView({ ids? })` chooses the most detailed zoom level at which all items (or the given items) fit the visible width and scrolls to them; `fitOnLoad` does this once after the first render. `api.flashItem(id)` briefly outlines a bar after scrolling to it (a host "Show" action can use it), using `--fg-flash-color`.
- X-4 (SHOULD) Sticky group headers. While the children of a group are scrolled under the header, the group's grid row stays pinned below the header (one pinned row at a time) so the user always knows which group the visible rows belong to. The pinned copy is presentational (`aria-hidden`); the real row keeps its place in the treegrid. Off with `stickyGroupHeaders: false`.
- X-5 (SHOULD) Run status styling. Besides `error`, `getItemStatus` can return `warning`, `success`, `running`, `pending` and `skipped` (DATA-14), each with its own tokens, a text equivalent in the accessible description (`messages.status`), and, for `running`, a subtle moving stripe on the bar (static under reduced motion). This lets hosts reuse the chart for live and historical runs.
- X-6 (SHOULD) Animated layout changes. When positions change because of data edits, bars, group frames and connectors move to their new places over `--fg-motion-duration`. No animation under `prefers-reduced-motion: reduce`, when `animateLayout` is false, on the first render, or when more than 500 visible bars would move.
- X-7 (SHOULD) Dependency preview. While a new dependency is dragged over a valid target, ghost bars (`--fg-preview-*`) show where the target and every affected item would land if the drop happened, computed with `computeLayout` on the hypothetical data. Ghosts disappear on cancel, on an invalid target and on drop. Off with `previewDependencyLayout: false`.
- X-8 (SHOULD) Host-driven highlight. `highlightedIds` (for example the results of a host search box) dims every other item and its connectors; an empty or missing array dims nothing. Combined with X-1, an item is dimmed if either feature dims it.
