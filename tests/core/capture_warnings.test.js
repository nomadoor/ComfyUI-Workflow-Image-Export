import assert from "node:assert/strict";
import test from "node:test";

import {
  attachCaptureWarnings,
  getExportWarningMessage,
  getNode2WarningMessage,
  partitionCaptureNotices,
} from "../../web/js/core/capture/warnings.mjs";

test("capture warnings survive on the returned blob", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  attachCaptureWarnings(blob, [
    "node2:transparent_recovery_failed",
    "node2:transparent_recovery_failed",
  ]);

  assert.deepEqual(blob.cwieWarnings, ["node2:transparent_recovery_failed"]);
  assert.match(getNode2WarningMessage(blob.cwieWarnings), /black or white matte/);
});

test("huge scope opacity limitation has a user-facing message", () => {
  assert.match(
    getExportWarningMessage(["scope:opacity_disabled_for_huge"]),
    /Selection cropping was preserved/
  );
});

test("unavailable transparency warning has a user-facing message", () => {
  assert.match(
    getNode2WarningMessage(["node2:transparent_background_unsupported"]),
    /this Node 2.0 capture/
  );
});

test("normal tiled routes are diagnostics rather than export warnings", () => {
  assert.deepEqual(partitionCaptureNotices([
    "render:tiled",
    "embed:failed",
    "render:tiled-png",
  ]), {
    diagnostics: ["render:tiled", "render:tiled-png"],
    warnings: ["embed:failed"],
  });
});

test("attaching no real warnings removes route-only warning metadata", () => {
  const blob = new Blob(["png"], { type: "image/png" });
  Object.defineProperty(blob, "cwieWarnings", {
    configurable: true,
    value: ["render:tiled", "render:tiled-png"],
    writable: true,
  });

  attachCaptureWarnings(blob, []);

  assert.equal(blob.cwieWarnings, undefined);
});
