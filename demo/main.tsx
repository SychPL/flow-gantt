// Demo page and browser-test harness. Query parameters:
//   data=example|600|5000   readonly=1   scale=1   width=<px>   strict=0 (disables StrictMode)
// Tests drive it through window.__fg (see e2e/).
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  type DemoItem,
  exampleBarVariant,
  exampleCanConnect,
  type JobData,
  large5000,
  reference600,
  referenceExample,
} from "../fixtures/data";
import { FlowGantt, type FlowGanttHandle, type FlowGanttProps, type ItemId } from "../src";
import { addItems, removeDependency, removeItems, reorder } from "../src/ops";
import "../src/styles.css";
import "./demo.css";

type Props = Partial<FlowGanttProps<JobData>>;
interface Harness {
  getHandle: () => FlowGanttHandle | null;
  events: { type: string; payload: unknown }[];
  setProps: (p: Props) => void;
  setData: (
    fn: (s: { items: DemoItem[]; dependencies: ReturnType<typeof referenceExample>["dependencies"] }) => typeof s,
  ) => void;
  mounts: number;
  remount: () => void;
  flushSync: typeof flushSync;
  /** Mounts the chart synchronously (perf=1 starts without it) and returns the time taken in ms. */
  mountTimed: () => number;
  setSelected: (ids: ItemId[]) => void;
  setCollapsed: (ids: ItemId[]) => void;
  ready: boolean;
}
declare global {
  interface Window {
    __fg: Harness;
    __fgRendered?: number;
  }
}

const params = new URLSearchParams(location.search);
const dataName = params.get("data") ?? "example";
const load = () => (dataName === "600" ? reference600() : dataName === "5000" ? large5000() : referenceExample());

function delayText(ms: number) {
  const s = Math.round(ms / 1000);
  return s >= 60 && s % 60 === 0 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s} seconds`;
}

function renderBar(item: DemoItem) {
  const d = item.data ?? {};
  if (item.kind === "group") return <span className="demo-bar-name">{item.label}</span>;
  return (
    <>
      <span className="demo-bar-id">#{d.jobId}</span>
      <span className="demo-bar-name">{item.label}</span>
      <span className="demo-badges">
        {d.delayMs ? <span className="demo-badge demo-delay">{delayText(d.delayMs)}</span> : null}
        {d.repeat ? (
          <span className="demo-badge demo-repeat">
            x {d.repeat.times} {d.repeat.type === "PARALLEL" ? "P" : "S"}
          </span>
        ) : null}
      </span>
    </>
  );
}

const columns: FlowGanttProps<JobData>["columns"] = [
  {
    id: "name",
    header: "ID Name",
    width: "fill",
    tree: true,
    render: (item) => (item.kind === "group" ? item.label : `#${item.data?.jobId ?? ""} ${item.label}`),
  },
];

let nextId = 1;

function App() {
  const [data, setData] = useState(() => {
    const d = load();
    return { items: d.items, dependencies: d.dependencies };
  });
  const origin = useMemo(() => load().origin, []);
  const [selected, setSelected] = useState<readonly ItemId[]>([]);
  const [collapsed, setCollapsed] = useState<readonly ItemId[]>([]);
  const [readOnly, setReadOnly] = useState(params.get("readonly") === "1");
  const [zoom, setZoom] = useState("1min");
  const [chain, setChain] = useState<"none" | "direct" | "full">("full");
  const [longest, setLongest] = useState(false);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(false);
  const [extra, setExtra] = useState<Props>({});
  const [key, setKey] = useState(0);
  const [shown, setShown] = useState(params.get("perf") !== "1");
  const handle = useRef<FlowGanttHandle>(null);

  const log = (type: string, payload: unknown) => window.__fg.events.push({ type, payload });
  window.__fg.setProps = (p) => setExtra((e) => ({ ...e, ...p }));
  window.__fg.setData = (fn) => setData((d) => fn(d));
  window.__fg.remount = () => setKey((k) => k + 1);
  window.__fg.setSelected = setSelected;
  window.__fg.setCollapsed = setCollapsed;
  window.__fg.mountTimed = () => {
    const t0 = performance.now();
    flushSync(() => setShown(true));
    return performance.now() - t0;
  };
  window.__fg.getHandle = () => handle.current;

  useEffect(() => {
    window.__fg.ready = true;
  }, []);

  const highlightedIds = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? data.items.filter((i) => i.label.toLowerCase().includes(s)).map((i) => i.id) : undefined;
  }, [search, data.items]);

  const remove = () => {
    if (selected.length === 0) return;
    setData((d) => {
      const s = removeItems(d, selected);
      return { items: [...s.items], dependencies: [...s.dependencies] };
    });
    setSelected([]);
  };
  const add = () =>
    setData((d) => {
      const id = `new-${nextId++}`;
      const s = addItems(d, [{ id, kind: "leaf", label: `New job ${nextId - 1}`, data: { jobId: 900 + nextId } }], {
        chain: false,
        newDependencyId: () => `nd-${nextId++}`,
      });
      return { items: [...s.items], dependencies: [...s.dependencies] };
    });

  return (
    <div className={dark ? "demo dark" : "demo"}>
      <div className="demo-toolbar">
        <strong>Flow Gantt</strong>
        <span>{data.items.length} items</span>
        <label>
          <input type="checkbox" checked={!readOnly} onChange={(e) => setReadOnly(!e.target.checked)} /> Edit
        </label>
        <label>
          Zoom{" "}
          <select value={zoom} onChange={(e) => setZoom(e.target.value)}>
            {["1min", "5min", "10min", "15min", "30min", "1h"].map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          Chain{" "}
          <select value={chain} onChange={(e) => setChain(e.target.value as typeof chain)}>
            <option>full</option>
            <option>direct</option>
            <option>none</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={longest} onChange={(e) => setLongest(e.target.checked)} /> Longest path
        </label>
        <label>
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark
        </label>
        <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <button type="button" onClick={() => handle.current?.fitToView()}>
          Fit
        </button>
        <button type="button" onClick={add} disabled={readOnly}>
          Add
        </button>
        <button type="button" onClick={remove} disabled={readOnly || selected.length === 0}>
          Remove
        </button>
      </div>
      <div className="demo-chart">
        {shown ? (
          <FlowGantt<JobData>
            key={key}
            ref={handle}
            aria-label="Flow chart"
            items={data.items}
            dependencies={data.dependencies}
            origin={origin}
            columns={columns}
            renderBar={renderBar}
            getBarVariant={exampleBarVariant}
            canConnect={exampleCanConnect}
            readOnly={readOnly}
            showTimeScale={params.get("scale") === "1"}
            zoomLevel={zoom}
            onZoomLevelChange={(z) => {
              setZoom(z);
              log("zoom", z);
            }}
            chainHighlight={chain}
            highlightLongestPath={longest}
            highlightedIds={highlightedIds}
            selectedIds={selected}
            onSelectionChange={(ids, info) => {
              setSelected(ids);
              log("selection", { ids, source: info.source });
            }}
            collapsedIds={collapsed}
            onCollapsedChange={(ids) => {
              setCollapsed(ids);
              log("collapsed", ids);
            }}
            onDependencyCreate={(draft) => {
              log("dependencyCreate", draft);
              setData((d) => ({
                items: d.items,
                dependencies: [...d.dependencies, { id: `nd-${nextId++}`, ...draft, gap: 0.5 }],
              }));
            }}
            onReorder={(change) => {
              log("reorder", { id: change.item.id, newParentId: change.newParentId, newIndex: change.newIndex });
              setData((d) => {
                const s = reorder(d, {
                  itemId: change.item.id,
                  newParentId: change.newParentId,
                  newIndex: change.newIndex,
                });
                return { items: [...s.items], dependencies: [...s.dependencies] };
              });
            }}
            canReorder={(change) => (change.item.parentId ?? null) === change.newParentId}
            onDeleteRequest={(ids) => log("delete", ids)}
            onContextMenu={(e) => {
              const t = e.target;
              log("contextmenu", {
                type: t.type,
                id: t.type === "item" ? t.item.id : t.type === "dependency" ? t.dependency.id : null,
                area: e.area,
              });
              if (t.type === "dependency" && !readOnly && params.get("removeOnMenu") === "1") {
                setData((d) => {
                  const s = removeDependency(d, t.dependency.id);
                  return { items: d.items, dependencies: [...s.dependencies] };
                });
              }
              return t.type !== "empty" && e.area === "timeline";
            }}
            onItemDoubleClick={(item) => log("dblclick", item.id)}
            onItemActivate={(item) => log("activate", item.id)}
            onDataError={(errors) => log("dataError", errors)}
            {...extra}
          />
        ) : null}
      </div>
    </div>
  );
}

window.__fg = {
  getHandle: () => null,
  events: [],
  setProps: () => {},
  setData: () => {},
  mounts: 0,
  remount: () => {},
  flushSync,
  mountTimed: () => 0,
  setSelected: () => {},
  setCollapsed: () => {},
  ready: false,
};
const root = createRoot(document.getElementById("root")!);
root.render(
  params.get("strict") === "0" ? (
    <App />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
