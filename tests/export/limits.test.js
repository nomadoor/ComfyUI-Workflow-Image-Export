import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_CANVAS_EDGE,
  PREVIEW_MAX_PIXELS,
  TILE_THRESHOLD_EDGE,
  TILE_THRESHOLD_PIXELS,
  isHugeRasterExport,
  normalizeCanvasDimension,
  resolveRasterExceedPlan,
  shouldTile,
  shouldUseTiledExceedMode,
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

test("tiled exceed mode activates only after the configured output edge is exceeded", () => {
  assert.equal(shouldUseTiledExceedMode({
    width: 2000,
    height: 1000,
    scale: 2,
    maxLongEdge: 4096,
    exceedMode: "tile",
  }), false);
  assert.equal(shouldUseTiledExceedMode({
    width: 2050,
    height: 1000,
    scale: 2,
    maxLongEdge: 4096,
    exceedMode: "tile",
  }), true);
  assert.equal(shouldUseTiledExceedMode({
    width: 8000,
    height: 1000,
    maxLongEdge: 0,
    exceedMode: "tile",
  }), true);
  assert.equal(shouldUseTiledExceedMode({
    width: 5000,
    height: 1000,
    maxLongEdge: 4096,
    exceedMode: "downscale",
  }), false);
  assert.equal(shouldUseTiledExceedMode({
    width: 17000,
    height: 1000,
    maxLongEdge: 20000,
    exceedMode: "downscale",
  }), true);
  assert.equal(shouldUseTiledExceedMode({
    width: 20000,
    height: 10000,
    maxLongEdge: 4096,
    exceedMode: "downscale",
  }), false);
  assert.equal(shouldUseTiledExceedMode({
    width: 50000,
    height: 50000,
    maxLongEdge: 20000,
    exceedMode: "downscale",
  }), true);
});

test("raster exceed planning carries the downscaled render scale into safety tiling", () => {
  assert.deepEqual(resolveRasterExceedPlan({
    width: 50000,
    height: 50000,
    scale: 1,
    maxLongEdge: 20000,
    exceedMode: "downscale",
  }), {
    useTiledExport: true,
    renderScale: 0.4,
  });
  assert.deepEqual(resolveRasterExceedPlan({
    width: 10000,
    height: 5000,
    scale: 2,
    maxLongEdge: 4096,
    exceedMode: "downscale",
  }), {
    useTiledExport: false,
    renderScale: 0.4096,
  });
});
