import assert from "node:assert/strict";
import test from "node:test";

import {
  formatNode2TilePixelLimitMessage,
  resolveExportCaptureOptions,
  resolveNode2ExportPolicy,
  resolveNode2TileScale,
} from "../../web/js/core/node2_export_policy.mjs";

test("Node 2.0 export always forces tiled capture", () => {
  assert.deepEqual(resolveNode2ExportPolicy({
    background: "transparent",
    exceedMode: "downscale",
  }), {
    exceedMode: "tile",
    node2TiledCapture: true,
  });
  assert.deepEqual(resolveNode2ExportPolicy({
    background: "ui",
    exceedMode: "tile",
  }), {
    exceedMode: "tile",
    node2TiledCapture: true,
  });
});

test("Node 2.0 uses native scale unless an internal debug scale is requested", () => {
  assert.equal(resolveNode2TileScale(), 1);
  assert.equal(resolveNode2TileScale("bad"), 1);
  assert.equal(resolveNode2TileScale(1.5), 1.5);
  assert.equal(resolveNode2TileScale(0.1), 0.25);
  assert.equal(resolveNode2TileScale(3), 2);
});

test("Node 2.0 pixel-limit guidance asks the user to reduce workflow bounds", () => {
  const message = formatNode2TilePixelLimitMessage({
    width: 10000,
    height: 7000,
  });
  assert.match(message, /10000x7000/);
  assert.match(message, /Reduce the workflow bounds/);
  assert.doesNotMatch(message, /output resolution/);
});

test("Classic final capture preserves exceed settings", () => {
  const onProgress = () => {};
  const options = resolveExportCaptureOptions({
    format: "png",
    exceedMode: "tile",
  }, { onProgress });

  assert.equal(options.exceedMode, "tile");
  assert.equal(options.onProgress, onProgress);
  assert.equal("node2TiledCapture" in options, false);
});

test("Node 2.0 final capture ignores a saved Legacy downscale policy", () => {
  const options = resolveExportCaptureOptions({
    exceedMode: "downscale",
    padding: 100,
    nodeOpacity: 25,
    scopeSelected: true,
  }, { isNode2Backend: true });

  assert.equal(options.exceedMode, "tile");
  assert.equal(options.node2TiledCapture, true);
  assert.equal(options.padding, 0);
  assert.equal(options.nodeOpacity, 100);
  assert.equal(options.scopeSelected, false);
});
