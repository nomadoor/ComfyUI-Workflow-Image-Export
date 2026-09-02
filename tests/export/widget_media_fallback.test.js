import test from "node:test";
import assert from "node:assert/strict";

import { drawPlannedWidgetOverlays } from "../../web/js/core/backends/widget_overlay_renderer.mjs";
import { buildOffscreenWidgetRenderPlan } from "../../web/js/core/backends/widget_render_plan.mjs";
import { drawWidgetMediaFallbacks } from "../../web/js/export/widget_media_fallback.mjs";

function mediaEntry(key, element, x = 40) {
  return {
    key,
    nodeId: key.split(":")[0],
    widgetIndex: Number(key.split(":")[1]),
    source: "media",
    element,
    graphRect: { x, y: 10, w: 120, h: 60 },
    nodeGraphRect: { x: 0, y: 0, w: 220, h: 100 },
  };
}

function createExportContext() {
  const calls = [];
  return {
    calls,
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    drawImage(media, ...rect) {
      calls.push({ media, rect });
    },
    fillRect(...rect) {
      calls.push({ kind: "fillRect", rect });
    },
    fillText(value, ...position) {
      calls.push({ kind: "fillText", value, position });
    },
    measureText(value) {
      return { width: String(value).length * 6 };
    },
  };
}

function connectedMediaGraphs(element) {
  const widget = {
    name: "preview",
    type: "preview:pano-1",
    y: 30,
    computedHeight: 80,
    margin: 10,
    element: {
      matches() { return false; },
      querySelector(selectors) {
        return /(?:canvas|img|video)/.test(selectors) ? element : null;
      },
      querySelectorAll(selectors) {
        return /(?:canvas|img|video)/.test(selectors) ? [element] : [];
      },
    },
  };
  return {
    liveGraph: {
      nodes: [{ id: "71", pos: [0, 0], size: [220, 120], widgets: [widget] }],
    },
    exportGraph: {
      nodes: [{
        id: 71,
        pos: [20, 40],
        size: [240, 140],
        widgets: [{ ...widget, element: undefined }],
      }],
    },
  };
}

test("widget-owned media uses one origin-clean snapshot across tiles", async () => {
  const previousDocument = globalThis.document;
  const source = { width: 320, height: 180, frame: 1 };
  let snapshotCopies = 0;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = { width: 0, height: 0, copiedFrame: null };
      canvas.getContext = () => ({
        drawImage(media) {
          snapshotCopies += 1;
          canvas.copiedFrame = media.frame;
        },
        getImageData() {
          return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
        },
      });
      return canvas;
    },
  };

  try {
    const cache = new Map();
    const plan = [mediaEntry("17:0", source)];
    const firstCtx = createExportContext();
    const firstCoverage = await drawWidgetMediaFallbacks({
      exportCtx: firstCtx,
      plan,
      bounds: { left: 0, top: 0, right: 100, bottom: 100 },
      scale: 1,
      mediaSnapshotCache: cache,
    });

    source.frame = 2;
    const secondCtx = createExportContext();
    const secondCoverage = await drawWidgetMediaFallbacks({
      exportCtx: secondCtx,
      plan,
      bounds: { left: 100, top: 0, right: 200, bottom: 100 },
      scale: 1,
      mediaSnapshotCache: cache,
    });

    assert.equal(snapshotCopies, 1);
    assert.equal(firstCtx.calls[0].media.copiedFrame, 1);
    assert.equal(secondCtx.calls[0].media.copiedFrame, 1);
    assert.deepEqual(firstCoverage.get("17"), [{ x: 40, y: 10, w: 120, h: 60 }]);
    assert.deepEqual(secondCoverage.get("17"), [{ x: 40, y: 10, w: 120, h: 60 }]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("multiple media widgets on one node keep independent snapshot ownership", async () => {
  const previousDocument = globalThis.document;
  const copiedFrames = [];
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0, copiedFrame: null };
      canvas.getContext = () => ({
        drawImage(media) {
          canvas.copiedFrame = media.frame;
          copiedFrames.push(media.frame);
        },
        getImageData() {
          return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
        },
      });
      return canvas;
    },
  };

  try {
    const ctx = createExportContext();
    const coverage = await drawWidgetMediaFallbacks({
      exportCtx: ctx,
      plan: [
        mediaEntry("22:0", { width: 64, height: 64, frame: "first" }, 10),
        mediaEntry("22:1", { width: 64, height: 64, frame: "second" }, 140),
      ],
      bounds: { left: 0, top: 0, right: 300, bottom: 100 },
      scale: 1,
      mediaSnapshotCache: new Map(),
    });

    assert.deepEqual(copiedFrames, ["first", "second"]);
    assert.deepEqual(ctx.calls.map((call) => call.media.copiedFrame), ["first", "second"]);
    assert.equal(coverage.get("22").length, 2);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("tainted widget media yields no coverage so placeholder ownership remains", async () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              throw new Error("tainted");
            },
          };
        },
      };
    },
  };

  try {
    const ctx = createExportContext();
    const coverage = await drawWidgetMediaFallbacks({
      exportCtx: ctx,
      plan: [mediaEntry("31:0", { width: 64, height: 64 })],
      bounds: { left: 0, top: 0, right: 200, bottom: 100 },
      scale: 1,
      mediaSnapshotCache: new Map(),
    });

    assert.equal(coverage.size, 0);
    assert.equal(ctx.calls.length, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("connected offscreen plan draws clean media and delegates exactly that widget", async () => {
  const previousDocument = globalThis.document;
  const source = { width: 64, height: 64 };
  globalThis.document = {
    createElement() {
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ({
        drawImage() {},
        getImageData() {
          return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
        },
      });
      return canvas;
    },
  };

  try {
    const plan = buildOffscreenWidgetRenderPlan({
      ...connectedMediaGraphs(source),
      includeDomOverlays: false,
    });
    const ctx = createExportContext();
    const bounds = { left: 0, top: 0, right: 300, bottom: 220 };
    const coverage = await drawWidgetMediaFallbacks({
      exportCtx: ctx,
      plan,
      bounds,
      scale: 1,
      mediaSnapshotCache: new Map(),
    });
    const result = await drawPlannedWidgetOverlays({
      exportCtx: ctx,
      plan,
      bounds,
      scale: 1,
      options: {
        mediaDelegationAvailable: false,
        mediaFallbackCoverage: coverage,
      },
    });

    assert.equal(ctx.calls.filter((call) => call.media).length, 1);
    assert.equal(result.delegated, 1);
    assert.equal(result.mediaPlaceholder, 0);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("connected offscreen plan turns tainted media into one owned placeholder", async () => {
  const previousDocument = globalThis.document;
  const source = { width: 64, height: 64 };
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              throw new Error("tainted");
            },
          };
        },
      };
    },
  };

  try {
    const plan = buildOffscreenWidgetRenderPlan({
      ...connectedMediaGraphs(source),
      includeDomOverlays: false,
    });
    const ctx = createExportContext();
    const bounds = { left: 0, top: 0, right: 300, bottom: 220 };
    const coverage = await drawWidgetMediaFallbacks({
      exportCtx: ctx,
      plan,
      bounds,
      scale: 1,
      mediaSnapshotCache: new Map(),
    });
    const result = await drawPlannedWidgetOverlays({
      exportCtx: ctx,
      plan,
      bounds,
      scale: 1,
      options: {
        mediaDelegationAvailable: false,
        mediaFallbackCoverage: coverage,
      },
    });

    assert.equal(ctx.calls.filter((call) => call.media).length, 0);
    assert.equal(result.delegated, 0);
    assert.equal(result.mediaPlaceholder, 1);
    assert.equal(
      ctx.calls.filter((call) => call.kind === "fillText" && call.value === "media unavailable").length,
      1
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
