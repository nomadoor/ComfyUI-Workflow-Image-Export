import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

import { renderTiledPng } from "../../web/js/export/tiled_render.mjs";
import { computeTileBounds } from "../../web/js/export/offscreen_render_utils.mjs";

function createPixelCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    pixelAt: () => [0, 0, 0, 0],
  };
  canvas.getContext = () => ({
    drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh) {
      canvas.pixelAt = (x, y) => {
        const sourceX = sx + Math.floor(((x - dx) * sw) / dw);
        const sourceY = sy + Math.floor(((y - dy) * sh) / dh);
        return source.pixelAt(sourceX, sourceY);
      };
    },
    getImageData(x, y, width, height) {
      const data = new Uint8ClampedArray(width * height * 4);
      let offset = 0;
      for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
          data.set(canvas.pixelAt(x + column, y + row), offset);
          offset += 4;
        }
      }
      return { data };
    },
  });
  return canvas;
}

function readPng(blobBytes) {
  const idat = [];
  let width = 0;
  let height = 0;
  let offset = 8;
  while (offset + 12 <= blobBytes.length) {
    const length = (
      (blobBytes[offset] << 24) |
      (blobBytes[offset + 1] << 16) |
      (blobBytes[offset + 2] << 8) |
      blobBytes[offset + 3]
    ) >>> 0;
    const type = new TextDecoder().decode(blobBytes.subarray(offset + 4, offset + 8));
    const data = blobBytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = view.getUint32(0);
      height = view.getUint32(4);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.length;
  }
  const raw = inflateSync(compressed);
  return {
    width,
    height,
    pixelAt(x, y) {
      const rowOffset = y * (1 + width * 4);
      assert.equal(raw[rowOffset], 0, "test encoder should use PNG filter 0");
      const pixelOffset = rowOffset + 1 + x * 4;
      return [...raw.subarray(pixelOffset, pixelOffset + 4)];
    },
  };
}

function coordinateColor(x, y) {
  return [x & 0xff, (x >>> 8) & 0xff, y & 0xff, 255];
}

test("scaled tiled PNG preserves coordinates across encoder tile boundaries", async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return createPixelCanvas();
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const renderedGraphRects = [];
  const mediaSnapshotCache = new Map();
  const blob = await renderTiledPng({
    workflowJson: { nodes: [] },
    options: {
      renderScaleFactor: 2,
      tileBleed: 64,
      mediaSnapshotCache,
    },
    bboxOverride: { width: 2500, height: 1 },
    compressionLevel: 0,
    renderOnce: async (_workflowJson, options) => {
      assert.equal(options.mediaSnapshotCache, mediaSnapshotCache);
      const tileGraphRect = options.tileRect;
      renderedGraphRects.push(tileGraphRect);
      const canvas = createPixelCanvas();
      canvas.width = Math.ceil(tileGraphRect.width * options.renderScaleFactor);
      canvas.height = Math.ceil(tileGraphRect.height * options.renderScaleFactor);
      const outputOriginX = Math.round(tileGraphRect.x * options.renderScaleFactor);
      const outputOriginY = Math.round(tileGraphRect.y * options.renderScaleFactor);
      canvas.pixelAt = (x, y) => coordinateColor(outputOriginX + x, outputOriginY + y);
      return canvas;
    },
  });

  const png = readPng(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual({ width: png.width, height: png.height }, { width: 5000, height: 2 });
  for (const x of [0, 2047, 2048, 4095, 4096, 4999]) {
    assert.deepEqual(png.pixelAt(x, 0), coordinateColor(x, 0), `pixel x=${x}`);
  }
  assert.equal(renderedGraphRects.length, 3);
});

test("fractional-scale final tile stays inside the clamped renderer canvas", async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      return createPixelCanvas();
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
  });

  const bbox = {
    minX: 0,
    minY: 0,
    paddedMinX: 0,
    paddedMinY: 0,
    width: 10001,
    height: 3,
  };
  const scale = 0.4096;
  const baseWidth = Math.ceil(bbox.width);
  const baseHeight = Math.ceil(bbox.height);
  const blob = await renderTiledPng({
    workflowJson: { nodes: [] },
    options: { renderScaleFactor: scale, tileBleed: 64 },
    bboxOverride: bbox,
    compressionLevel: 0,
    renderOnce: async (_workflowJson, options) => {
      const tileBounds = computeTileBounds(
        bbox,
        options.tileRect,
        baseWidth,
        baseHeight
      );
      const canvas = createPixelCanvas();
      canvas.width = Math.ceil(tileBounds.width * scale);
      canvas.height = Math.ceil(tileBounds.height * scale);
      const outputOriginX = Math.round(tileBounds.paddedMinX * scale);
      const outputOriginY = Math.round(tileBounds.paddedMinY * scale);
      canvas.pixelAt = (x, y) => coordinateColor(outputOriginX + x, outputOriginY + y);
      return canvas;
    },
  });

  const png = readPng(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual({ width: png.width, height: png.height }, { width: 4097, height: 2 });
  for (const x of [0, 2047, 2048, 4095, 4096]) {
    assert.deepEqual(png.pixelAt(x, 0), coordinateColor(x, 0), `pixel x=${x}`);
  }
});
