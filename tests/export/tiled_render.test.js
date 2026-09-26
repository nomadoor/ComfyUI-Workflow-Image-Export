import test from "node:test";
import assert from "node:assert/strict";

import {
  renderTiled,
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

test("fractional render scales quantize expanded bounds and crops to output pixels", () => {
  const geometry = resolveScaledTileGeometry({
    x: 2048,
    y: 2048,
    width: 2048,
    height: 1024,
    outputWidth: 5000,
    outputHeight: 3000,
    renderScaleFactor: 0.4096,
    bleed: 64,
  });

  assert.deepEqual(geometry.crop, {
    x: 27,
    y: 27,
    width: 2048,
    height: 1024,
  });
  assert.equal(Number.isInteger(geometry.tileRect.x * 0.4096), true);
  assert.equal(Number.isInteger(geometry.tileRect.y * 0.4096), true);
  assert.equal(Number.isInteger(geometry.tileRect.width * 0.4096), true);
  assert.equal(Number.isInteger(geometry.tileRect.height * 0.4096), true);
});

test("canvas tiling renders directly at the requested raster scale", async (t) => {
  const previousDocument = globalThis.document;
  const drawCalls = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage(...args) {
              drawCalls.push(args);
            },
          };
        },
      };
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const renderCalls = [];
  const output = await renderTiled({
    workflowJson: { nodes: [] },
    options: {
      renderScaleFactor: 2,
      tileBleed: 64,
      backgroundMode: "transparent",
    },
    bboxOverride: { width: 1500, height: 1000 },
    createRenderSession: async () => ({
      async render(options) {
        renderCalls.push(options);
        return { width: 1, height: 1 };
      },
      cleanup() {},
    }),
  });

  assert.equal(output.width, 3000);
  assert.equal(output.height, 2000);
  assert.equal(renderCalls.length, 2);
  assert.equal(renderCalls.every((call) => call.renderScaleFactor === 2), true);
  assert.deepEqual(renderCalls.map((call) => call.tileRect), [
    { x: 0, y: 0, width: 1088, height: 1000 },
    { x: 960, y: 0, width: 540, height: 1000 },
  ]);
  assert.deepEqual(drawCalls.map((call) => call.slice(1)), [
    [0, 0, 2048, 2000, 0, 0, 2048, 2000],
    [128, 0, 952, 2000, 2048, 0, 952, 2000],
  ]);
});

test("canvas tiling reuses one render session for every tile", async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            fillRect() {},
            drawImage() {},
          };
        },
      };
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  let sessions = 0;
  let cleanups = 0;
  let sessionOptions;
  const renderedTiles = [];
  const bboxOverride = { width: 5000, height: 1000 };
  await renderTiled({
    workflowJson: { nodes: [] },
    options: {
      renderScaleFactor: 1,
      tileBleed: 64,
      backgroundMode: "transparent",
    },
    bboxOverride,
    createRenderSession: async (_workflowJson, options) => {
      sessions += 1;
      sessionOptions = options;
      return {
        async render(options) {
          renderedTiles.push(options.tileRect);
          return { width: 1, height: 1 };
        },
        cleanup() {
          cleanups += 1;
        },
      };
    },
  });

  assert.equal(sessions, 1);
  assert.equal(sessionOptions.bboxOverride, bboxOverride);
  assert.equal(renderedTiles.length, 3);
  assert.equal(cleanups, 1);
});

test("canvas tiling closes its render session when a tile fails", async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return { fillRect() {}, drawImage() {} };
        },
      };
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  let cleanups = 0;
  await assert.rejects(
    renderTiled({
      workflowJson: { nodes: [] },
      options: { renderScaleFactor: 1, backgroundMode: "transparent" },
      bboxOverride: { width: 3000, height: 1000 },
      createRenderSession: async () => ({
        async render() {
          throw new Error("tile failed");
        },
        cleanup() {
          cleanups += 1;
        },
      }),
    }),
    /tile failed/
  );
  assert.equal(cleanups, 1);
});
