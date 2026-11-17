# Flow Gantt

A React chart for dependency flows: a tree grid on the left and a timeline on the right, where every bar is placed after its predecessors (finish-to-start) instead of on a calendar. Written from scratch through a clean-room process to replace a commercial Gantt library in its first host application, to be released under the MIT license.

Status: 0.1 pre-release. All milestones of the clean-room plan are implemented (layout, data helpers, rendering, interactions, accessibility, performance, features beyond parity). The API may still change before 1.0.

The specification, decisions log and provenance record live in the source repository (`docs/spec.md`, `docs/decisions.md`, `docs/provenance.md`); they are not shipped in the npm package.

## Install


```bash
pnpm add @sychpl/flow-gantt
```

React 18.3 or 19 is the only peer dependency; there are no runtime dependencies.

## Usage

```tsx
import { useState } from "react";
import { FlowGantt, type FlowItem, type FlowDependency } from "@sychpl/flow-gantt";
import "@sychpl/flow-gantt/styles.css";

const items: FlowItem[] = [
  { id: "setup", kind: "group", label: "Setup" },
  { id: "login", kind: "leaf", parentId: "setup", label: "Login" },
  { id: "stock", kind: "leaf", parentId: "setup", label: "Check stock" },
  { id: "mrp", kind: "leaf", label: "Run MRP" },
];
const dependencies: FlowDependency[] = [{ id: "d1", from: "login", to: "stock" }];

function Chart() {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div style={{ height: 500 }}>
      <FlowGantt
        aria-label="Flow chart"
        items={items}
        dependencies={dependencies}
        origin={new Date(2026, 10, 20, 9, 0)}
        columns={[{ id: "name", header: "Name", width: "fill", tree: true }]}
        selectedIds={selected}
        onSelectionChange={setSelected}
        onDependencyCreate={(d) => {
          /* add { id, ...d, gap } to your dependencies */
        }}
      />
    </div>
  );
}
```

The component is controlled: the host owns `items`, `dependencies`, `selectedIds` and `collapsedIds` (the last two have uncontrolled fallbacks) and receives change requests through callbacks. The chart fills its parent element.

### Layout

Every leaf has the same nominal span (`defaultSpan`, 3 base units) and starts at the origin, at its group's start, or `gap` units (`dependencyGap`, 0.5) after its latest predecessor ends. A group spans its children. Layout is a pure function, also exported without React:

```ts
import { computeLayout, wouldCreateCycle } from "@sychpl/flow-gantt/layout";

const layout = computeLayout({ items, dependencies, origin });
layout.entries.get("stock"); // { startUnits: 3.5, endUnits: 6.5, start: Date, end: Date }
layout.longestPath; // ids of the chain that ends last
layout.errors; // invalid data is reported, never thrown
```

Cycles, unknown ids, duplicates and invalid numbers are reported through `errors` (and `onDataError`) and ignored; rendering never throws.

### Data helpers

`@sychpl/flow-gantt/ops` has pure, non-mutating helpers for host-side edits: `addItems` (optionally chained), `removeItems`, `moveToGroup`, `ungroup`, `removeDependency`, `reorder`. They return new arrays and never generate ids themselves.

### Main props

| Prop | Purpose |
| --- | --- |
| `columns` | Grid columns; one is the tree column (`tree: true`), `render` returns React nodes |
| `renderBar(item, ctx)` | Bar content (the library provides a flex row box with overflow hidden) |
| `getBarVariant(item, { predecessors })` | `default`, `dependent`, `delayed`, `group` or any custom name (`data-variant`) |
| `getItemStatus(item)` | `error`, `warning`, `success`, `running`, `pending`, `skipped` |
| `readOnly` | Disables handles, linking, reordering and delete requests |
| `canConnectFrom`, `canConnect`, `onDependencyCreate` | Dependency creation by dragging a handle or with the `D` key |
| `canReorder`, `onReorder` | Row reordering by dragging a grid row or with Alt+Up/Down |
| `onContextMenu(event)` | Return `true` to suppress the browser menu; the library renders no menu |
| `zoomLevels`, `zoomLevel`, `onZoomLevelChange` | Ctrl+wheel zoom around the pointer (1 min to 1 hour by default) |
| `layers` | Custom timeline layers with item geometry (`below-rows`, `below-bars`, `above-bars`) |
| `groupFrames`, `stickyGroupHeaders`, `chainHighlight`, `highlightLongestPath`, `highlightedIds`, `animateLayout`, `previewDependencyLayout`, `fitOnLoad`, `linkEndMarker` | Display features |
| `messages` | All accessibility strings (English defaults in `defaultMessages`) |

The imperative handle (`ref`) offers `scrollToItem`, `scrollTo`, `getScroll`, `getItemBox`, `focusItem`, `beginDependency`, `cancelInteraction`, `fitToView` and `flashItem`. Section 13 of the specification lists every type.

### Theming

All colours come from CSS custom properties with neutral fallbacks, set on the chart or any ancestor: `--fg-surface`, `--fg-text-color`, `--fg-border-color`, `--fg-row-bg`, `--fg-row-alt-bg`, `--fg-bar-default-bg`, `--fg-link-color`, `--fg-focus-ring` and the rest of the list in section 10 of the specification, plus `--fg-status-error-border` (decision D-24). Library selectors have zero specificity, so a single class in host CSS overrides them. Stable styling hooks are the data attributes `data-kind`, `data-variant`, `data-selected`, `data-status`, `data-collapsed` and `data-level` on rows and bars. A dark theme is only a different set of token values (see `demo/demo.css`).

### Accessibility

The grid is a WAI-ARIA treegrid with a roving tab index (one Tab stop). Arrow keys, Home, End and Page Up/Down move; Left and Right collapse and expand; Space, Ctrl+Space, Shift+arrows and Ctrl+A select; Enter calls `onItemActivate`; Shift+F10 or the context-menu key opens the host menu; Delete calls `onDeleteRequest`; `D` starts keyboard linking. Each row describes its predecessors, successors, status and variant; changes are announced in a polite live region. Timeline bars are presentational duplicates of the rows.

### Security

Host strings (labels, status text, messages) are always rendered as React text; the library never inserts HTML, never builds URLs from host data and never uses `eval` or injected style elements, so it works under a strict Content Security Policy (`style-src 'self'`). React nodes returned by `renderBar`, column `render` functions and layers are trusted by contract: the host is responsible for their content.

### Not supported in v1

Moving or resizing bars, calendars and working time, dependency types other than finish-to-start, more than two tree levels (`maxDepth`, decision D-13), creating dependencies by touch (touch supports scrolling, tap to select and long press for the context menu), export and printing.

## Development

Node 24 and pnpm 11 are required (`fnm exec --using=24 -- pnpm ...`).

```bash
pnpm install
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

```bash
pnpm demo
```

Other scripts: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm size` (bundle budget), `pnpm bench` (layout benchmark, run after `pnpm build`), `pnpm check:licenses`. The demo page takes `?data=example|600|5000`, `readonly=1` and `scale=1`.

CI runs the unit tests (also on React 18.3), the Chromium suite against the production demo build served with a strict CSP, the performance tests with three times the spec thresholds, the size budget and the license check. The spec's performance numbers must be confirmed on the reference machine before each release.

## Clean-room rules for contributors

Read section 0 of the specification before writing code. In short: do not open, read or look up the source code, documentation or rendered output of dhtmlxGantt or any copy of it. If the specification does not answer a question, ask the specification owner.
