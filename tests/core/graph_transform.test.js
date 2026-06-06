import test from "node:test";
import assert from "node:assert/strict";

import {
  canvasPointToGraph,
  createExportDragAndScale,
  graphPointToCanvas,
  graphRectToExportRect,
} from "../../web/js/core/graph_transform.mjs";

test("graph/canvas point conversion follows LiteGraph DragAndScale convention", () => {
  const transform = { scale: 2, offset: [-100, -50] };
  assert.deepEqual(graphPointToCanvas([100, 50], transform), [0, 0]);
  assert.deepEqual(canvasPointToGraph([0, 0], transform), [100, 50]);
  assert.deepEqual(graphPointToCanvas([125, 70], transform), [50, 40]);
  assert.deepEqual(canvasPointToGraph([50, 40], transform), [125, 70]);
});

test("createExportDragAndScale keeps offsets in graph units", () => {
  const transform = createExportDragAndScale({ left: 100, top: 50 }, 2);
  assert.deepEqual(transform, { scale: 2, offset: [-100, -50] });
  assert.deepEqual(graphPointToCanvas([100, 50], transform), [0, 0]);
});

test("graphRectToExportRect maps graph bounds into export pixels", () => {
  assert.deepEqual(
    graphRectToExportRect({ x: 120, y: 70, w: 30, h: 20 }, { left: 100, top: 50 }, 2),
    { x: 40, y: 40, w: 60, h: 40 }
  );
});
