import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCaptureWarnings,
  getNode2WarningMessage,
} from "../../web/js/core/capture/warnings.mjs";

test("capture warnings survive on the returned blob", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  attachCaptureWarnings(blob, [
    "node2:transparent_recovery_failed",
    "node2:transparent_recovery_failed",
  ]);

  assert.deepEqual(blob.cwieWarnings, ["node2:transparent_recovery_failed"]);
  assert.match(getNode2WarningMessage(blob.cwieWarnings), /black background/);
});

test("unavailable transparency warning has a user-facing message", () => {
  assert.match(
    getNode2WarningMessage(["node2:transparent_background_unsupported"]),
    /this Node 2.0 capture/
  );
});
