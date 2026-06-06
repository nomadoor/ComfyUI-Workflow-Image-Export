import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLinkFilter,
  applyRenderFilter,
} from "../../web/js/export/offscreen_render_utils.mjs";

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

test("applyLinkFilter clears Map links for none mode without selected ids", () => {
  const graph = {
    links: new Map([
      [1, { origin_id: 1, target_id: 2 }],
      [2, { origin_id: 2, target_id: 3 }],
    ]),
  };

  applyLinkFilter(graph, null, "none");

  assert.equal(graph.links instanceof Map, true);
  assert.equal(graph.links.size, 0);
});

test("applyLinkFilter clears object links for none mode without selected ids", () => {
  const graph = {
    links: {
      1: { origin_id: 1, target_id: 2 },
      2: { origin_id: 2, target_id: 3 },
    },
  };

  applyLinkFilter(graph, [], "none");

  assert.deepEqual(graph.links, {});
});

test("applyLinkFilter preserves selected link filtering behavior", () => {
  const graph = {
    links: {
      1: { origin_id: 1, target_id: 2 },
      2: { origin_id: 2, target_id: 3 },
    },
  };

  applyLinkFilter(graph, [1, 2], "selected");

  assert.deepEqual(graph.links, {
    1: { origin_id: 1, target_id: 2 },
  });
});
