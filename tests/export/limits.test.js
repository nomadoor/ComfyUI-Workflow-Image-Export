import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  MAX_CANVAS_EDGE,
  PREVIEW_MAX_PIXELS,
  TILE_THRESHOLD_EDGE,
  TILE_THRESHOLD_PIXELS,
  isHugeRasterExport,
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

test("isHugeRasterExport includes output scale", () => {
  assert.equal(isHugeRasterExport({ width: 3000, height: 3000, scale: 1 }), false);
  assert.equal(isHugeRasterExport({ width: 3000, height: 3000, scale: 2 }), true);
});

test("PREVIEW_MAX_PIXELS is shared preview budget", () => {
  assert.equal(PREVIEW_MAX_PIXELS, 1024 * 1024);
});

test("hard canvas thresholds use exact binary-megabyte pixel counts", () => {
  assert.equal(TILE_THRESHOLD_EDGE, 6144);
  assert.equal(TILE_THRESHOLD_PIXELS, 25_165_824);
});

test("Tile keeps the requested resolution on the live renderer below the hard canvas threshold", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 5000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "tile",
    }),
    { renderer: "live", renderScale: 1, legacyMaxLongEdge: 0 }
  );
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 3000,
      height: 1000,
      scale: 2,
      maxLongEdge: 4096,
      exceedMode: "tile",
    }),
    { renderer: "live", renderScale: 2, legacyMaxLongEdge: 0 }
  );
});

test("Tile switches renderers only at the hard canvas threshold of the scaled output", () => {
  const cases = [
    [{ width: 6144, height: 1000 }, "live"],
    [{ width: 6145, height: 1000 }, "tiled-offscreen"],
    [{ width: 5000, height: 5000 }, "live"],
    [{ width: 5033, height: 5000 }, "live"],
    [{ width: 5034, height: 5000 }, "tiled-offscreen"],
    [{ width: 5200, height: 5000 }, "tiled-offscreen"],
    [{ width: 4000, height: 4000, scale: 2 }, "tiled-offscreen"],
    [{ width: 8000, height: 1000, maxLongEdge: 0 }, "tiled-offscreen"],
  ];

  for (const [input, renderer] of cases) {
    const route = resolveClassicRasterRoute({
      maxLongEdge: 4096,
      ...input,
      exceedMode: "tile",
    });
    const label = `${input.width}x${input.height} at ${input.scale ?? 1}x`;
    assert.equal(route.renderer, renderer, label);
    assert.equal(route.legacyMaxLongEdge, 0, label);
  }
});

test("Downscale fits the configured edge and keeps the Legacy limit", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 5000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }),
    { renderer: "live", renderScale: 4096 / 5000, legacyMaxLongEdge: 4096 }
  );
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 10000,
      height: 5000,
      scale: 2,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }),
    { renderer: "live", renderScale: 0.4096, legacyMaxLongEdge: 4096 }
  );
  assert.equal(
    resolveClassicRasterRoute({
      width: 20000,
      height: 10000,
      maxLongEdge: 4096,
      exceedMode: "downscale",
    }).renderer,
    "live"
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
    { renderer: "tiled-offscreen", renderScale: 0.4, legacyMaxLongEdge: 20000 }
  );
  assert.equal(
    resolveClassicRasterRoute({
      width: 17000,
      height: 1000,
      maxLongEdge: 20000,
      exceedMode: "downscale",
    }).renderer,
    "tiled-offscreen"
  );
});

test("unknown exceed modes keep the live renderer and its configured limit", () => {
  assert.deepEqual(
    resolveClassicRasterRoute({
      width: 8000,
      height: 1000,
      maxLongEdge: 4096,
      exceedMode: "other",
    }),
    { renderer: "live", renderScale: 1, legacyMaxLongEdge: 4096 }
  );
});

test("capture passes the route's Legacy limit instead of the dialog max edge", async () => {
  const source = await readFile(
    new URL("../../web/js/core/capture/index.mjs", import.meta.url),
    "utf8"
  );

  assert.equal(source.includes("resolveRasterExceedPlan"), false);
  assert.match(source, /resolveClassicRasterRoute\(/);
  assert.match(source, /route\.renderer === "tiled-offscreen"/);
  assert.match(source, /maxLongEdge:\s*route\.legacyMaxLongEdge/);
});
