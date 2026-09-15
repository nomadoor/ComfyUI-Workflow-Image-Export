import test from "node:test";
import assert from "node:assert/strict";

import { evaluateWebpAvailability } from "../../web/js/ui/webp_availability.mjs";

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
    shouldTileFn(width, height) {
      assert.equal(width, 100);
      assert.equal(height, 50);
      return true;
    },
  });

  assert.equal(result.blocked, true);
  assert.match(result.message, /100x50/);
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
