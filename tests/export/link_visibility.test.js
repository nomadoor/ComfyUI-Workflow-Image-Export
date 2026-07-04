import test from "node:test";
import assert from "node:assert/strict";

import { hideGraphLinks } from "../../web/js/export/link_visibility.mjs";

test("hideGraphLinks detaches graph and node link references until restored", () => {
  const links = {
    10: { origin_id: 1, target_id: 2 },
    11: { origin_id: 1, target_id: 2 },
  };
  const graph = {
    _nodes: [
      {
        id: 1,
        inputs: [{ link: 9 }],
        outputs: [{ links: [10, 11] }],
      },
      {
        id: 2,
        inputs: [{ link: 10 }],
        outputs: [],
      },
    ],
    links,
  };

  const restore = hideGraphLinks(graph);

  assert.deepEqual(graph.links, {});
  assert.equal(graph._nodes[0].inputs[0].link, null);
  assert.deepEqual(graph._nodes[0].outputs[0].links, []);
  assert.equal(graph._nodes[1].inputs[0].link, null);

  restore();

  assert.equal(graph.links, links);
  assert.equal(graph._nodes[0].inputs[0].link, 9);
  assert.deepEqual(graph._nodes[0].outputs[0].links, [10, 11]);
  assert.equal(graph._nodes[1].inputs[0].link, 10);
});
