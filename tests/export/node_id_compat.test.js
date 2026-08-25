import assert from "node:assert/strict";
import test from "node:test";

import { computeGraphBBox } from "../../web/js/export/bbox.mjs";
import { syncLiveGraphState } from "../../web/js/export/live_graph_sync.mjs";

test("selection bbox accepts arbitrary frontend string node ids", () => {
  const graph = {
    _nodes: [
      { id: "node-alpha", pos: [10, 20], size: [100, 80] },
      { id: "node-beta", pos: [500, 600], size: [200, 100] },
    ],
  };

  assert.deepEqual(
    computeGraphBBox(graph, {
      selectedNodeIds: ["node-alpha"],
      useSelectionOnly: true,
    }),
    {
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 100,
      width: 100,
      height: 80,
      paddedMinX: 10,
      paddedMinY: 20,
    }
  );
});

test("selection bbox preserves subgraph-scoped node ids", () => {
  const graph = {
    _nodes: [
      { id: "3:5", pos: [20, 30], size: [80, 60] },
      { id: "3:6", pos: [400, 500], size: [100, 100] },
    ],
  };

  const bbox = computeGraphBBox(graph, {
    selectedNodeIds: ["3:5"],
    useSelectionOnly: true,
  });

  assert.deepEqual(
    {
      minX: bbox.minX,
      minY: bbox.minY,
      maxX: bbox.maxX,
      maxY: bbox.maxY,
    },
    { minX: 20, minY: 30, maxX: 100, maxY: 90 }
  );
});

test("live graph sync joins serialized numeric ids to frontend string ids", () => {
  const exportWidget = { type: "customtext", value: "serialized" };
  const liveWidget = { type: "customtext", value: "live" };
  const exportNode = {
    id: 63,
    pos: [0, 0],
    size: [100, 50],
    widgets: [exportWidget],
    widgets_values: ["serialized"],
  };
  const liveNode = {
    id: "63",
    pos: [25, 35],
    size: [220, 140],
    widgets: [liveWidget],
    widgets_values: ["live"],
    properties: { current: true },
    imgs: [{ unsafeLiveMedia: true }],
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );

  assert.deepEqual(exportNode.pos, [25, 35]);
  assert.deepEqual(exportNode.size, [220, 140]);
  assert.deepEqual(exportNode.widgets_values, ["live"]);
  assert.deepEqual(exportNode.properties, { current: true });
  assert.equal(exportNode.widgets[0].value, "live");
  assert.equal(exportNode.imgs, undefined);
});
