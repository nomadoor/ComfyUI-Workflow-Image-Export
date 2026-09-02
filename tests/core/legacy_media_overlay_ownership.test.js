import test from "node:test";
import assert from "node:assert/strict";

import {
  drawImageOverlays,
  drawVhsVideoOverlays,
} from "../../web/js/core/backends/legacy_media_overlays.mjs";

class MockImageElement {}
class MockCanvasElement {}
class MockVideoElement {}

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
  globalThis.document = { querySelectorAll() { return []; } };
});

test.afterEach(() => {
  delete globalThis.HTMLImageElement;
  delete globalThis.HTMLCanvasElement;
  delete globalThis.HTMLVideoElement;
  delete globalThis.document;
});

test("planned Panorama canvas is excluded from the legacy image scanner", () => {
  const panoCanvas = new MockCanvasElement();
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
    skipElements: new Set([panoCanvas]),
  });

  assert.equal(drawCalls.length, 0);
});

test("planned VHS video is excluded from the legacy VHS scanner", () => {
  const video = new MockVideoElement();
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
    skipElements: new Set([video]),
  });

  assert.equal(drawCalls.length, 0);
});
