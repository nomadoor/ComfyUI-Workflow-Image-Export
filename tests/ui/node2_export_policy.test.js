import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveNode2ExportPolicy,
} from "../../web/js/ui/node2_export_policy.mjs";

test("transparent Node 2.0 export forces fit while other backgrounds retain tile mode", () => {
  assert.deepEqual(resolveNode2ExportPolicy({
    background: "transparent",
    exceedMode: "tile",
  }), {
    transparentFit: true,
    exceedMode: "downscale",
    node2TiledCapture: false,
  });
  assert.deepEqual(resolveNode2ExportPolicy({
    background: "ui",
    exceedMode: "tile",
  }), {
    transparentFit: false,
    exceedMode: "tile",
    node2TiledCapture: true,
  });
});
