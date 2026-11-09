import test from "node:test";
import assert from "node:assert/strict";

import { syncLiveGraphState } from "../../web/js/export/live_graph_sync.mjs";

test("clone nodes receive captured runtime preview images LiteGraph draws natively", () => {
  const first = { naturalWidth: 64, naturalHeight: 64 };
  const second = { naturalWidth: 32, naturalHeight: 32 };
  const captured = Object.freeze({ imgs: Object.freeze([first, second]), imageIndex: 1 });
  const exportNode = { id: 7, pos: [0, 0], size: [10, 10] };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [{ id: "7", pos: [0, 0], size: [10, 10] }], _groups: [] },
    new Map([["7", captured]])
  );

  assert.deepEqual(exportNode.imgs, [first, second]);
  assert.equal(Object.isFrozen(exportNode.imgs), false, "clone owns a mutable image list");
  assert.equal(exportNode.imgs[0], first, "image elements are shared, not reloaded");
  assert.equal(exportNode.imageIndex, 1);
});

test("clone nodes without a captured preview are left without images", () => {
  const exportNode = { id: 7, pos: [0, 0], size: [10, 10] };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [{ id: "7", pos: [0, 0], size: [10, 10], imgs: [{}] }], _groups: [] },
    new Map()
  );

  assert.equal(exportNode.imgs, undefined);
  assert.equal("imageIndex" in exportNode, false);
});
