import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMediaFallbackTargets,
  resolveMediaFallbackRect,
} from "../../web/js/export/media_fallback_plan.mjs";

test("media fallback targets the first owned media widget per node", () => {
  const targets = buildMediaFallbackTargets([
    { key: "7:0", nodeId: 7, source: "text", graphRect: { x: 0, y: 0, w: 10, h: 10 } },
    { key: "7:1", nodeId: 7, source: "media", graphRect: { x: 20, y: 30, w: 80, h: 40 } },
    { key: "7:2", nodeId: 7, source: "media", graphRect: { x: 20, y: 80, w: 80, h: 40 } },
  ]);

  assert.deepEqual(targets.get("7"), {
    key: "7:1",
    graphRect: { x: 20, y: 30, w: 80, h: 40 },
  });
});

test("media target graph rectangles convert to tile-local output pixels", () => {
  assert.deepEqual(
    resolveMediaFallbackRect({
      target: { key: "7:1", graphRect: { x: 120, y: 80, w: 50, h: 25 } },
      bounds: { left: 100, top: 60 },
      scale: 2,
    }),
    {
      previewRect: { x: 40, y: 40, w: 100, h: 50 },
      coverageGraphRect: { x: 120, y: 80, w: 50, h: 25 },
    }
  );
});
