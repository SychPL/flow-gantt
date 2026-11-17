// @vitest-environment node
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { referenceExample } from "../fixtures/data";
import { FlowGantt } from "../src";

it("AT-P4 renders on a server without window or document", () => {
  expect(typeof window).toBe("undefined");
  expect(typeof document).toBe("undefined");
  const ex = referenceExample();
  const html = renderToString(
    <FlowGantt {...ex} columns={[{ id: "n", header: "ID Name", tree: true }]} aria-label="Flow chart" />,
  );
  expect(html).toContain('role="treegrid"');
  expect(html).toContain("Check stock");
});
