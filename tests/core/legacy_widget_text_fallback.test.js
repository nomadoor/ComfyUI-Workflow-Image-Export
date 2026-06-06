import test from "node:test";
import assert from "node:assert/strict";

import { drawWidgetTextFallback } from "../../web/js/core/backends/legacy_widget_text_fallback.mjs";

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
      calls.push({ text, x, y });
    },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
  };
}

test.beforeEach(() => {
  globalThis.window = {
    LiteGraph: {
      NODE_FONT: "Arial",
      NODE_TITLE_HEIGHT: 30,
    },
  };
});

test.afterEach(() => {
  delete globalThis.window;
});

test("single-line text widgets are not redrawn by generic text fallback", () => {
  const ctx = createMockContext();
  const result = drawWidgetTextFallback({
    exportCtx: ctx,
    graph: {
      nodes: [
        {
          id: 1,
          type: "SaveImage",
          title: "Save Image",
          pos: [0, 0],
          size: [240, 100],
          widgets_values: ["ComfyUI"],
          widgets: [
            {
              type: "text",
              name: "filename_prefix",
              value: "ComfyUI",
              options: {},
            },
          ],
        },
      ],
    },
    bounds: { left: 0, top: 0 },
    scale: 1,
    coveredNodeIds: new Set(),
  });

  assert.equal(result.drawn, 0);
  assert.deepEqual(ctx.calls, []);
});

test("multiline text widgets still use fallback drawing", () => {
  const ctx = createMockContext();
  const result = drawWidgetTextFallback({
    exportCtx: ctx,
    graph: {
      nodes: [
        {
          id: 2,
          type: "Note",
          title: "Note",
          pos: [0, 0],
          size: [240, 140],
          widgets_values: ["line one\nline two"],
          widgets: [
            {
              type: "text",
              name: "text",
              value: "line one\nline two",
              y: 30,
              height: 90,
              options: { multiline: true },
            },
          ],
        },
      ],
    },
    bounds: { left: 0, top: 0 },
    scale: 1,
    coveredNodeIds: new Set(),
  });

  assert.equal(result.drawn, 1);
  assert.ok(ctx.calls.length > 0);
});
