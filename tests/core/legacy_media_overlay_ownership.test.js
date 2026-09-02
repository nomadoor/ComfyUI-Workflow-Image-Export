import test from "node:test";
import assert from "node:assert/strict";

import {
  drawImageOverlays,
  drawVhsVideoOverlays,
} from "../../web/js/core/backends/legacy_media_overlays.mjs";
import { drawWidgetMediaFallbacks } from "../../web/js/export/widget_media_fallback.mjs";

class MockImageElement {}
class MockCanvasElement {
  constructor() {
    this.width = 100;
    this.height = 80;
  }
}
class MockVideoElement {}

const MEDIA_RECT = {
  left: 40,
  top: 50,
  right: 140,
  bottom: 130,
  width: 100,
  height: 80,
};

function scratchCanvas() {
  return {
    width: 0,
    height: 0,
    getContext() {
      return {
        drawImage() {},
        getImageData() {
          return { data: new Uint8ClampedArray(4) };
        },
      };
    },
  };
}

function canvasRoot(elementsBySelector) {
  return {
    querySelectorAll(selector) {
      return elementsBySelector.get(selector) || [];
    },
  };
}

function uiCanvasFor(root) {
  return {
    canvas: {
      closest(selector) {
        return selector === ".graph-canvas-panel" ? root : null;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
      },
    },
    ds: { scale: 1, offset: [0, 0] },
  };
}

test.beforeEach(() => {
  globalThis.HTMLImageElement = MockImageElement;
  globalThis.HTMLCanvasElement = MockCanvasElement;
  globalThis.HTMLVideoElement = MockVideoElement;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return scratchCanvas();
    },
    querySelectorAll() { return []; },
  };
});

test.afterEach(() => {
  delete globalThis.HTMLImageElement;
  delete globalThis.HTMLCanvasElement;
  delete globalThis.HTMLVideoElement;
  delete globalThis.document;
});

test("planned Panorama canvas is excluded from the legacy image scanner", async () => {
  const panoCanvas = new MockCanvasElement();
  panoCanvas.getBoundingClientRect = () => MEDIA_RECT;
  panoCanvas.closest = () => ({
    getAttribute(name) {
      return name === "data-node-id" ? "81" : null;
    },
  });
  const root = canvasRoot(new Map([
    ["img", []],
    ["canvas", [panoCanvas]],
  ]));
  const drawCalls = [];

  drawImageOverlays({
    exportCtx: { drawImage(...args) { drawCalls.push(args); } },
    uiCanvas: uiCanvasFor(root),
    bounds: { left: 0, top: 0 },
    scale: 1,
    nodeRects: [],
  });

  assert.equal(drawCalls.length, 1);
  drawCalls.length = 0;

  drawImageOverlays({
    exportCtx: { drawImage(...args) { drawCalls.push(args); } },
    uiCanvas: uiCanvasFor(root),
    bounds: { left: 0, top: 0 },
    scale: 1,
    nodeRects: [],
    skipElements: new Set([panoCanvas]),
  });

  assert.equal(drawCalls.length, 0);

  const fallbackDrawCalls = [];
  const graphRect = { x: 40, y: 50, w: 100, h: 80 };
  const coverage = await drawWidgetMediaFallbacks({
    exportCtx: {
      beginPath() {},
      clip() {},
      drawImage(...args) { fallbackDrawCalls.push(args); },
      rect() {},
      restore() {},
      save() {},
    },
    plan: [{
      key: "81:0",
      nodeId: "81",
      source: "media",
      element: panoCanvas,
      graphRect,
      nodeGraphRect: { x: 0, y: 0, w: 200, h: 200 },
    }],
    bounds: { left: 0, top: 0, width: 800, height: 600 },
    scale: 1,
    mediaSnapshotCache: new Map(),
  });

  assert.equal(fallbackDrawCalls.length, 1);
  assert.deepEqual(coverage.get("81"), [graphRect]);
});

test("planned VHS video is excluded from the legacy VHS scanner", () => {
  const video = new MockVideoElement();
  video.readyState = 4;
  video.getBoundingClientRect = () => MEDIA_RECT;
  video.classList = { contains(name) { return name === "VHS_loopedvideo"; } };
  video.closest = (selector) => selector === ".vhs_preview" ? {} : null;
  const root = canvasRoot(new Map([["video", [video]]]));
  const drawCalls = [];

  drawVhsVideoOverlays({
    exportCtx: { drawImage(...args) { drawCalls.push(args); } },
    uiCanvas: uiCanvasFor(root),
    bounds: { left: 0, top: 0 },
    scale: 1,
    nodeRects: [],
  });

  assert.equal(drawCalls.length, 1);
  drawCalls.length = 0;

  drawVhsVideoOverlays({
    exportCtx: { drawImage(...args) { drawCalls.push(args); } },
    uiCanvas: uiCanvasFor(root),
    bounds: { left: 0, top: 0 },
    scale: 1,
    nodeRects: [],
    skipElements: new Set([video]),
  });

  assert.equal(drawCalls.length, 0);
});
