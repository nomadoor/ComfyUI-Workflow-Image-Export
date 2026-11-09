import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_CANVAS_EDGE,
  PREVIEW_MAX_PIXELS,
  TILE_THRESHOLD_EDGE,
  TILE_THRESHOLD_PIXELS,
  normalizeCanvasDimension,
  resolveClassicRasterRoute,
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

test("PREVIEW_MAX_PIXELS is shared preview budget", () => {
  assert.equal(PREVIEW_MAX_PIXELS, 1024 * 1024);
});

test("hard canvas thresholds use exact binary-megabyte pixel counts", () => {
  assert.equal(TILE_THRESHOLD_EDGE, 6144);
  assert.equal(TILE_THRESHOLD_PIXELS, 25_165_824);
});

test("Tile keeps the requested resolution below the hard canvas threshold", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 5000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "tile",
    }),
    { tiled: false, renderScale: 1 }
  );
});

test("Tile switches to tiled rendering only at the hard canvas threshold", () => {
  const cases = [
    [{ width: 6144, height: 1000 }, false],
    [{ width: 6145, height: 1000 }, true],
    [{ width: 5000, height: 5000 }, false],
    [{ width: 5033, height: 5000 }, false],
    [{ width: 5034, height: 5000 }, true],
    [{ width: 5200, height: 5000 }, true],
    [{ width: 6000, height: 5000 }, true],
    [{ width: 8000, height: 1000, maxLongEdge: 0 }, true],
  ];

  for (const [input, tiled] of cases) {
    const route = resolveClassicRasterRoute({
      maxLongEdge: 4096,
      ...input,
      exceedMode: "tile",
    });
    const label = `${input.width}x${input.height}`;
    assert.equal(route.tiled, tiled, label);
    assert.equal(route.renderScale, 1, label);
  }
});

test("Downscale renders at the scale that fits the configured edge", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 5000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }),
    { tiled: false, renderScale: 4096 / 5000 }
  );
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 10000,
      height: 5000,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }),
    { tiled: false, renderScale: 0.4096 }
  );
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 800,
      height: 400,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }),
    { tiled: false, renderScale: 1 }
  );
});

test("Downscale uses tiled rendering only when the downscaled output is still unsafe", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 50000,
      height: 50000,
      maxLongEdge: 20000,
      exceedMode: "downscale",
    }),
    { tiled: true, renderScale: 0.4 }
  );
  assert.equal(
    resolveClassicRasterRoute({
      width: 17000,
      height: 1000,
      maxLongEdge: 20000,
      exceedMode: "downscale",
    }).tiled,
    true
  );
});

test("unknown exceed modes downscale like the default policy", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 8000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "other",
    }),
    { tiled: false, renderScale: 4096 / 8000 }
  );
});

test("Classic capture renders every raster export through the clone exporter", async () => {
  const source = await readFile(
    new URL("../../web/js/core/capture/index.mjs", import.meta.url),
    "utf8"
  );

  assert.equal(source.includes("captureLegacy"), false);
  assert.match(source, /resolveClassicRasterRoute\(/);
  assert.match(source, /scale:\s*route\.renderScale/);
  assert.match(source, /forceTile:\s*route\.tiled/);
});
