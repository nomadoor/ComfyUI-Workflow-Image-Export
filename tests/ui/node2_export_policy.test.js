import assert from "node:assert/strict";
import test from "node:test";

import {
  formatNode2TilePixelLimitMessage,
  resolveExportCaptureOptions,
  resolveNode2ExportPolicy,
  resolveNode2OutputScale,
} from "../../web/js/core/node2_export_policy.mjs";
import { resolveOutputResolutionScale } from "../../web/js/core/output_scale.mjs";

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

test("Node 2.0 output resolution maps 200% to a true 2x scale", () => {
  assert.equal(resolveNode2OutputScale("200%"), 2);
  assert.equal(resolveNode2OutputScale("100%"), 1);
  assert.equal(resolveNode2OutputScale("auto"), 1);
});

test("shared output resolution mapping defaults unknown values to 1x", () => {
  assert.equal(resolveOutputResolutionScale("200%"), 2);
  assert.equal(resolveOutputResolutionScale("100%"), 1);
  assert.equal(resolveOutputResolutionScale("auto"), 1);
  assert.equal(resolveOutputResolutionScale(undefined), 1);
});

test("Node 2.0 pixel-limit guidance only suggests 100% for a 200% request", () => {
  const at200 = formatNode2TilePixelLimitMessage({
    width: 10000,
    height: 7000,
    outputResolution: "200%",
  });
  assert.match(at200, /10000x7000/);
  assert.match(at200, /Use 100% output resolution/);

  const at100 = formatNode2TilePixelLimitMessage({
    width: 10000,
    height: 7000,
    outputResolution: "100%",
  });
  assert.match(at100, /Reduce the workflow bounds/);
  assert.doesNotMatch(at100, /Use 100% output resolution/);
});

test("Classic final capture preserves resolution and exceed settings", () => {
  const onProgress = () => {};
  const options = resolveExportCaptureOptions({
    format: "png",
    outputResolution: "200%",
    exceedMode: "tile",
  }, { onProgress });

  assert.equal(options.outputResolution, "200%");
  assert.equal(options.exceedMode, "tile");
  assert.equal(options.onProgress, onProgress);
  assert.equal("node2TiledCapture" in options, false);
});

test("Node 2.0 final capture ignores a saved Legacy downscale policy", () => {
  const options = resolveExportCaptureOptions({
    outputResolution: "200%",
    exceedMode: "downscale",
    padding: 100,
    nodeOpacity: 25,
    scopeSelected: true,
  }, { isNode2Backend: true });

  assert.equal(options.outputResolution, "200%");
  assert.equal(options.exceedMode, "tile");
  assert.equal(options.node2TiledCapture, true);
  assert.equal(options.padding, 0);
  assert.equal(options.nodeOpacity, 100);
  assert.equal(options.scopeSelected, false);
});
