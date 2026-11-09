import test from "node:test";
import assert from "node:assert/strict";

import { captureClassicRenderModel } from "../../web/js/export/classic_render_model.mjs";

test("Classic render model freezes live widget text and geometry at export start", async () => {
  const widget = {
    name: "text",
    type: "customtext",
    value: "snapshot text",
    y: 30,
    computedHeight: 90,
    margin: 4,
    options: { multiline: true },
  };
  const node = {
    id: 7,
    pos: new Float32Array([10, 20]),
    size: new Float32Array([240, 140]),
    widgets: [widget],
  };

  const model = await captureClassicRenderModel({ graph: { nodes: [node] } });
  widget.value = "changed later";
  widget.computedHeight = 0;
  node.pos[0] = 999;
  node.widgets.splice(0, 1);

  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.widgetPlan), true);
  assert.equal(Object.isFrozen(model.widgetPlan[0]), true);
  assert.equal(model.widgetPlan[0].text, "snapshot text");
  assert.deepEqual(model.widgetInventory, [{
    nodeId: 7,
    widgets: [{ name: "text", type: "customtext" }],
  }]);
  assert.deepEqual(model.widgetPlan[0].graphRect, { x: 14, y: 54, w: 232, h: 82 });
  assert.deepEqual(model.widgetPlan[0].nodeGraphRect, { x: 10, y: 20, w: 240, h: 140 });
});

function installScratchCanvasDocument(t) {
  // Each probe canvas becomes tainted after drawing cross-origin media.
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      let tainted = false;
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(media) {
              if (media.crossOrigin === "tainted") tainted = true;
            },
            getImageData() {
              if (tainted) throw new Error("SecurityError");
              return { data: new Uint8ClampedArray(4) };
            },
          };
        },
      };
    },
  };
  t.after(() => {
    delete globalThis.document;
  });
}

test("Classic render model keeps origin-clean runtime preview images for clone drawing", async (t) => {
  installScratchCanvasDocument(t);
  const first = { naturalWidth: 64, naturalHeight: 64 };
  const second = { naturalWidth: 32, naturalHeight: 32 };
  const node = { id: 7, pos: [0, 0], size: [100, 100], widgets: [], imgs: [first, second], imageIndex: 1 };

  const model = await captureClassicRenderModel({ graph: { nodes: [node] } });
  node.imgs.length = 0;
  node.imageIndex = 0;

  assert.equal(Object.isFrozen(model.runtimePreviews.get("7")), true);
  assert.deepEqual(model.runtimePreviews.get("7"), { imgs: [first, second], imageIndex: 1 });
  assert.equal(model.runtimePreviews.get("7").imgs[0], first);
});

test("Classic render model omits previews that would taint or that are not canvas-drawn", async (t) => {
  installScratchCanvasDocument(t);
  const clean = { naturalWidth: 64, naturalHeight: 64 };
  const tainted = { naturalWidth: 64, naturalHeight: 64, crossOrigin: "tainted" };
  const nodes = [
    { id: 1, pos: [0, 0], size: [10, 10], widgets: [], imgs: [clean, tainted] },
    { id: 2, pos: [0, 0], size: [10, 10], widgets: [], imgs: [clean], animatedImages: true },
    { id: 3, pos: [0, 0], size: [10, 10], widgets: [], imgs: [] },
    { id: 4, pos: [0, 0], size: [10, 10], widgets: [] },
    { id: 5, pos: [0, 0], size: [10, 10], widgets: [], imgs: [clean] },
  ];

  const model = await captureClassicRenderModel({ graph: { nodes } });

  assert.deepEqual([...model.runtimePreviews.keys()], ["5"]);
});
