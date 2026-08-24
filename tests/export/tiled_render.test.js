import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveScaledTileGeometry,
  resolveTiledPngOutputSize,
} from "../../web/js/export/tiled_render.mjs";

test("tiled PNG output dimensions include the render scale", () => {
  assert.deepEqual(resolveTiledPngOutputSize({ width: 5000, height: 3000 }, 2), {
    baseWidth: 5000,
    baseHeight: 3000,
    scale: 2,
    width: 10000,
    height: 6000,
  });
});

test("scaled tile geometry converts encoder pixels back to graph coordinates", () => {
  assert.deepEqual(resolveScaledTileGeometry({
    x: 2048,
    y: 2048,
    width: 2048,
    height: 1024,
    outputWidth: 10000,
    outputHeight: 6000,
    renderScaleFactor: 2,
    bleed: 64,
  }), {
    tileRect: {
      x: 960,
      y: 960,
      width: 1152,
      height: 640,
    },
    crop: {
      x: 128,
      y: 128,
      width: 2048,
      height: 1024,
    },
  });
});

test("scaled tile geometry preserves the scale-one contract", () => {
  assert.deepEqual(resolveScaledTileGeometry({
    x: 2048,
    y: 0,
    width: 952,
    height: 1000,
    outputWidth: 3000,
    outputHeight: 1000,
    bleed: 64,
  }), {
    tileRect: {
      x: 1984,
      y: 0,
      width: 1016,
      height: 1000,
    },
    crop: {
      x: 64,
      y: 0,
      width: 952,
      height: 1000,
    },
  });
});
