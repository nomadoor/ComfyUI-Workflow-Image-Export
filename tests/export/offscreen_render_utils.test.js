import test from "node:test";
import assert from "node:assert/strict";

import { applyRenderFilter } from "../../web/js/export/offscreen_render_utils.mjs";

test("applyRenderFilter removes all nodes for none mode without selected ids", () => {
  const graph = {
    _nodes: [{ id: 1 }, { id: 2 }],
  };

  applyRenderFilter(graph, [], "none");

  assert.deepEqual(graph._nodes, []);
});

test("applyRenderFilter calls graph.remove for each node in none mode", () => {
  const removed = [];
  const graph = {
    _nodes: [{ id: 1 }, { id: 2 }],
    remove(node) {
      removed.push(node.id);
    },
  };

  applyRenderFilter(graph, null, "none");

  assert.deepEqual(removed, [1, 2]);
});

test("applyRenderFilter preserves selected filtering behavior", () => {
  const graph = {
    _nodes: [{ id: 1 }, { id: 2 }, { id: 3 }],
  };

  applyRenderFilter(graph, [2], "selected");

  assert.deepEqual(graph._nodes, [{ id: 2 }]);
});
