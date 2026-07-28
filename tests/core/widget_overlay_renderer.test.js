import test from "node:test";
import assert from "node:assert/strict";

import {
  drawPlannedWidgetOverlays,
} from "../../web/js/core/backends/widget_overlay_renderer.mjs";

function createMockContext() {
  const calls = [];
  return {
    calls,
    font: "",
    fillStyle: "",
    textBaseline: "",
    measureText(text) {
      return { width: String(text).length * 6 };
    },
    fillText(text, x, y) {
      calls.push(["fillText", text, x, y]);
    },
    fillRect(...args) {
      calls.push(["fillRect", ...args]);
    },
    save() {
      calls.push(["save"]);
    },
    restore() {
      calls.push(["restore"]);
    },
    beginPath() {},
    rect(...args) {
      calls.push(["rect", ...args]);
    },
    clip() {},
  };
}

function textEntry(key, x) {
  return {
    key,
    nodeId: Number(key.split(":")[0]),
    widgetIndex: 0,
    graphRect: { x, y: 10, w: 80, h: 40 },
    nodeGraphRect: { x: 0, y: 0, w: 300, h: 100 },
    source: "text",
    styleSource: "default",
    element: null,
    text: key,
    style: {
      fontSize: 11,
      lineHeight: 14,
      paddingLeft: 2,
      paddingTop: 2,
      paddingRight: 2,
      paddingBottom: 2,
      background: null,
      color: "#ffffff",
      font: "11px sans-serif",
    },
  };
}

test("N text entries draw N text regions", async () => {
  const ctx = createMockContext();
  const result = await drawPlannedWidgetOverlays({
    exportCtx: ctx,
    plan: [textEntry("1:0", 10), textEntry("2:0", 100), textEntry("3:0", 190)],
    bounds: { left: 0, top: 0, right: 300, bottom: 100 },
    scale: 1,
  });

  assert.equal(result.drawn, 3);
  assert.equal(ctx.calls.filter((call) => call[0] === "fillText").length, 3);
  assert.ok(ctx.calls.filter((call) => call[0] === "fillRect").length >= 3);
});

test("entry drawing is clipped to both tile and owning node rectangles", async () => {
  const ctx = createMockContext();
  const entry = textEntry("7:0", 80);
  entry.nodeGraphRect = { x: 90, y: 20, w: 30, h: 20 };

  const result = await drawPlannedWidgetOverlays({
    exportCtx: ctx,
    plan: [entry],
    bounds: { left: 100, top: 0, right: 200, bottom: 100 },
    scale: 1,
  });

  assert.equal(result.drawn, 1);
  assert.ok(ctx.calls.some((call) =>
    call[0] === "rect" &&
    call[1] === 0 &&
    call[2] === 20 &&
    call[3] === 20 &&
    call[4] === 20
  ));
});

test("background-only capture fallback counts as a drawn owned region", async () => {
  const ctx = createMockContext();
  const entry = textEntry("8:0", 10);
  entry.source = "capture";
  entry.text = "";
  entry.element = null;

  const result = await drawPlannedWidgetOverlays({
    exportCtx: ctx,
    plan: [entry],
    bounds: { left: 0, top: 0, right: 300, bottom: 100 },
    scale: 1,
  });

  assert.equal(result.drawn, 1);
  assert.equal(ctx.calls.filter((call) => call[0] === "fillText").length, 0);
  assert.equal(ctx.calls.filter((call) => call[0] === "fillRect").length, 1);
});

test("duplicate keys are rendered only once", async () => {
  const ctx = createMockContext();
  const entry = textEntry("4:0", 10);
  const result = await drawPlannedWidgetOverlays({
    exportCtx: ctx,
    plan: [entry, { ...entry, graphRect: { ...entry.graphRect, x: 150 } }],
    bounds: { left: 0, top: 0, right: 300, bottom: 100 },
    scale: 1,
  });

  assert.equal(result.drawn, 1);
  assert.equal(result.skippedDuplicate, 1);
  assert.equal(ctx.calls.filter((call) => call[0] === "fillText").length, 1);
});

test("entries outside a tile are skipped and intersecting entries are clipped", async () => {
  const ctx = createMockContext();
  const result = await drawPlannedWidgetOverlays({
    exportCtx: ctx,
    plan: [textEntry("5:0", 80), textEntry("6:0", 220)],
    bounds: { left: 100, top: 0, right: 200, bottom: 100 },
    scale: 1,
  });

  assert.equal(result.drawn, 1);
  assert.equal(result.skippedOutside, 1);
  assert.ok(ctx.calls.some((call) =>
    call[0] === "rect" &&
    call[1] === 0 &&
    call[2] === 10 &&
    call[3] === 60 &&
    call[4] === 40
  ));
});
