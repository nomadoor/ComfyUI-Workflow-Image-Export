import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveNode2ExportPolicy,
} from "../../web/js/ui/node2_export_policy.mjs";

test("transparent Node 2.0 export retains the selected tile policy", () => {
  assert.deepEqual(resolveNode2ExportPolicy({
    background: "transparent",
    exceedMode: "tile",
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
