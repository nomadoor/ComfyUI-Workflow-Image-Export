import assert from "node:assert/strict";
import test from "node:test";

import {
  boundsFromNodeRects,
  filterNodeRectsBySelected,
} from "../../web/js/core/backends/legacy_bounds.mjs";

test("selection bounds accept current LiteGraph string node ids", () => {
  const nodeRects = [
    { id: "7", left: 10, top: 20, right: 110, bottom: 120 },
    { id: 8, left: 300, top: 400, right: 500, bottom: 600 },
    { left: -100, top: -100, right: 800, bottom: 800 },
  ];

  const selected = filterNodeRectsBySelected(nodeRects, [7]);

  assert.deepEqual(selected, [nodeRects[0]]);
  assert.deepEqual(boundsFromNodeRects(selected), {
    left: 10,
    top: 20,
    right: 110,
    bottom: 120,
    width: 100,
    height: 100,
  });
});

test("selection bounds normalize selected ids and ignore non-node rectangles", () => {
  const nodeRects = [
    { id: "12", left: 0, top: 0, right: 50, bottom: 60 },
    { id: 13, left: 100, top: 100, right: 200, bottom: 220 },
    { id: "not-a-node", left: -10, top: -10, right: 500, bottom: 500 },
  ];

  assert.deepEqual(
    filterNodeRectsBySelected(nodeRects, ["12", "13"]),
    [nodeRects[0], nodeRects[1]]
  );
});

test("selection bounds preserve arbitrary frontend string node ids", () => {
  const nodeRects = [
    { id: "node-alpha", left: 1, top: 2, right: 11, bottom: 22 },
    { id: "node-beta", left: 100, top: 200, right: 300, bottom: 400 },
  ];

  assert.deepEqual(filterNodeRectsBySelected(nodeRects, ["node-alpha"]), [nodeRects[0]]);
});
