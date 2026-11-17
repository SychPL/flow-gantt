import { render } from "@testing-library/react";
import { createRef, useState } from "react";
import { exampleBarVariant, type JobData, referenceExample } from "../fixtures/data";
import { FlowGantt, type FlowGanttHandle, type FlowGanttProps, type ItemId } from "../src";

export const columns: FlowGanttProps<JobData>["columns"] = [
  { id: "name", header: "ID Name", width: "fill", tree: true },
];

type Props = Partial<FlowGanttProps<JobData>>;

/** Controlled harness: selection and collapse state live in React state like a real host. */
export function Harness(props: Props & { handleRef?: React.Ref<FlowGanttHandle> }) {
  const [ex] = useState(referenceExample);
  const [selected, setSelected] = useState<readonly ItemId[]>(props.selectedIds ?? []);
  const [collapsed, setCollapsed] = useState<readonly ItemId[]>(props.collapsedIds ?? []);
  const { handleRef, ...rest } = props;
  return (
    <FlowGantt<JobData>
      ref={handleRef}
      items={ex.items}
      dependencies={ex.dependencies}
      origin={ex.origin}
      columns={columns}
      getBarVariant={exampleBarVariant}
      animateLayout={false}
      {...rest}
      selectedIds={selected}
      onSelectionChange={(ids, info) => {
        setSelected(ids);
        props.onSelectionChange?.(ids, info);
      }}
      collapsedIds={collapsed}
      onCollapsedChange={(ids) => {
        setCollapsed(ids);
        props.onCollapsedChange?.(ids);
      }}
    />
  );
}

export function renderChart(props: Props = {}) {
  const handle = createRef<FlowGanttHandle>();
  const utils = render(<Harness {...props} handleRef={handle} />);
  return { ...utils, handle };
}

export const q = (container: HTMLElement, sel: string) => container.querySelector(sel) as HTMLElement;
export const qa = (container: HTMLElement, sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];

/** Grid row element by item label. */
export function rowByLabel(container: HTMLElement, label: string): HTMLElement {
  const el = qa(container, '[role="row"][aria-label]').find((r) => r.getAttribute("aria-label") === label);
  if (!el) throw new Error(`row ${label} not found`);
  return el;
}

/** Bar element for the item with this label (same row index as the grid row). */
export function barByLabel(container: HTMLElement, label: string): HTMLElement {
  const r = rowByLabel(container, label).dataset.fgRow;
  const el = q(container, `.fg-bar[data-fg-bar="${r}"]`);
  if (!el) throw new Error(`bar ${label} not found`);
  return el;
}

export const px = (v: string) => Number.parseFloat(v);

export function boxOf(el: HTMLElement) {
  return { left: px(el.style.left), top: px(el.style.top), width: px(el.style.width), height: px(el.style.height) };
}
