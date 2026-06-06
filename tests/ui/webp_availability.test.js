import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateWebpAvailability,
  getOutputResolutionScale,
} from "../../web/js/ui/webp_availability.mjs";

test("getOutputResolutionScale maps preview resolution choices", () => {
  assert.equal(getOutputResolutionScale("200%"), 2);
  assert.equal(getOutputResolutionScale("100%"), 1);
  assert.equal(getOutputResolutionScale("auto"), 1);
});

test("evaluateWebpAvailability allows non-webp formats", () => {
  const result = evaluateWebpAvailability({
    format: "png",
    bbox: { width: 100000, height: 100000 },
    shouldTileFn: () => true,
  });

  assert.equal(result.blocked, false);
  assert.equal(result.message, "");
});

test("evaluateWebpAvailability blocks huge webp exports", () => {
  const result = evaluateWebpAvailability({
    format: "webp",
    bbox: { width: 100, height: 50 },
    scale: 2,
    shouldTileFn(width, height) {
      assert.equal(width, 200);
      assert.equal(height, 100);
      return true;
    },
  });

  assert.equal(result.blocked, true);
  assert.match(result.message, /200x100/);
});

test("evaluateWebpAvailability permits webp when bbox is absent or small", () => {
  assert.equal(evaluateWebpAvailability({ format: "webp", bbox: null }).blocked, false);
  assert.equal(
    evaluateWebpAvailability({
      format: "webp",
      bbox: { width: 100, height: 50 },
      shouldTileFn: () => false,
    }).blocked,
    false
  );
});
