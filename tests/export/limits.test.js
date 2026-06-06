import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CANVAS_EDGE,
  PREVIEW_MAX_PIXELS,
  TILE_THRESHOLD_EDGE,
  TILE_THRESHOLD_PIXELS,
  isHugeRasterExport,
  normalizeCanvasDimension,
  shouldTile,
} from "../../web/js/export/limits.mjs";

test("normalizeCanvasDimension returns safe positive integer dimensions", () => {
  assert.equal(normalizeCanvasDimension(1.2), 2);
  assert.equal(normalizeCanvasDimension(0), 1);
  assert.equal(normalizeCanvasDimension(-10), 1);
  assert.equal(normalizeCanvasDimension("bad"), 1);
});

test("shouldTile detects edge, pixel, and hard canvas limits", () => {
  assert.equal(shouldTile(TILE_THRESHOLD_EDGE, TILE_THRESHOLD_EDGE), true);
  assert.equal(shouldTile(100, 100), false);
  assert.equal(shouldTile(MAX_CANVAS_EDGE + 1, 10), true);
  assert.equal(shouldTile(TILE_THRESHOLD_PIXELS + 1, 1), true);
});

test("isHugeRasterExport includes output scale", () => {
  assert.equal(isHugeRasterExport({ width: 3000, height: 3000, scale: 1 }), false);
  assert.equal(isHugeRasterExport({ width: 3000, height: 3000, scale: 2 }), true);
});

test("PREVIEW_MAX_PIXELS is shared preview budget", () => {
  assert.equal(PREVIEW_MAX_PIXELS, 1024 * 1024);
});
