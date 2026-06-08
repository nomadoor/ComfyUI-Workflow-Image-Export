import test from "node:test";
import assert from "node:assert/strict";

import {
  drawMediaSafely,
  isCanvasOriginClean,
} from "../../web/js/core/backends/safe_media_draw.mjs";

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.calls = [];
  }

  drawImage(source, ...args) {
    this.calls.push(["drawImage", source, ...args]);
    if (source?.throwOnDraw) {
      throw new Error("draw failed");
    }
    if (source?.tainted) {
      this.canvas.tainted = true;
    }
  }

  getImageData() {
    if (this.canvas.tainted) {
      const error = new Error("tainted");
      error.name = "SecurityError";
      throw error;
    }
    return { data: new Uint8ClampedArray([0, 0, 0, 0]) };
  }

  fillRect(...args) {
    this.calls.push(["fillRect", ...args]);
  }

  strokeRect(...args) {
    this.calls.push(["strokeRect", ...args]);
  }

  fillText(...args) {
    this.calls.push(["fillText", ...args]);
  }

  save() {}

  restore() {}
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this.tainted = false;
    this.ctx = new FakeContext(this);
  }

  getContext() {
    return this.ctx;
  }
}

function withFakeDocument(fn) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return new FakeCanvas();
    },
  };
  try {
    return fn();
  } finally {
    globalThis.document = originalDocument;
  }
}

test("isCanvasOriginClean returns false for tainted canvases", () => {
  const canvas = new FakeCanvas();
  assert.equal(isCanvasOriginClean(canvas), true);
  canvas.tainted = true;
  assert.equal(isCanvasOriginClean(canvas), false);
});

test("drawMediaSafely draws clean media through a scratch canvas", () => {
  withFakeDocument(() => {
    const exportCanvas = new FakeCanvas();
    const media = { tainted: false };
    const result = drawMediaSafely(exportCanvas.ctx, media, 10, 20, 30, 40);

    assert.deepEqual(result, { ok: true, reason: "drawn" });
    assert.equal(exportCanvas.tainted, false);
    assert.equal(exportCanvas.ctx.calls.filter((call) => call[0] === "drawImage").length, 1);
    assert.equal(exportCanvas.ctx.calls.some((call) => call[0] === "fillRect"), false);
  });
});

test("drawMediaSafely placeholders tainted media without tainting export canvas", () => {
  withFakeDocument(() => {
    const exportCanvas = new FakeCanvas();
    const media = { tainted: true };
    const result = drawMediaSafely(exportCanvas.ctx, media, 10, 20, 80, 40);

    assert.equal(result.ok, false);
    assert.equal(result.reason, "tainted");
    assert.equal(exportCanvas.tainted, false);
    assert.equal(exportCanvas.ctx.calls.some((call) => call[0] === "drawImage"), false);
    assert.equal(exportCanvas.ctx.calls.some((call) => call[0] === "fillRect"), true);
  });
});
