import assert from "node:assert/strict";
import test from "node:test";

import {
  recoverTransparentCanvas,
} from "../../web/js/export/transparent_recovery.mjs";

class FakeContext {
  constructor(canvas) {
    this.canvas = canvas;
  }

  getImageData() {
    return { data: this.canvas.pixels };
  }

  putImageData(imageData) {
    this.canvas.pixels = new Uint8ClampedArray(imageData.data);
  }
}

class FakeCanvas {
  constructor(width, height, pixels = null) {
    this.width = width;
    this.height = height;
    this.pixels = pixels || new Uint8ClampedArray(width * height * 4);
    this.context = new FakeContext(this);
  }

  getContext() {
    return this.context;
  }
}

function withCanvasEnvironment(fn) {
  const previousDocument = globalThis.document;
  const previousImageData = globalThis.ImageData;
  globalThis.ImageData = class ImageData {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
  globalThis.document = {
    createElement(tagName) {
      assert.equal(tagName, "canvas");
      return new FakeCanvas(0, 0);
    },
  };
  try {
    return fn();
  } finally {
    globalThis.document = previousDocument;
    globalThis.ImageData = previousImageData;
  }
}

function pixelCanvas(r, g, b) {
  return new FakeCanvas(1, 1, new Uint8ClampedArray([r, g, b, 255]));
}

test("recovers opaque, transparent, and half-transparent pixels", () => {
  withCanvasEnvironment(() => {
    const opaque = recoverTransparentCanvas(
      pixelCanvas(60, 80, 100),
      pixelCanvas(60, 80, 100),
      "#000000",
      "#ffffff"
    );
    assert.deepEqual([...opaque.pixels], [60, 80, 100, 255]);

    const transparent = recoverTransparentCanvas(
      pixelCanvas(0, 0, 0),
      pixelCanvas(255, 255, 255),
      "#000000",
      "#ffffff"
    );
    assert.deepEqual([...transparent.pixels], [0, 0, 0, 0]);

    const half = recoverTransparentCanvas(
      pixelCanvas(30, 30, 30),
      pixelCanvas(157, 157, 157),
      "#000000",
      "#ffffff"
    );
    assert.ok(Math.abs(half.pixels[0] - 60) <= 1);
    assert.ok(Math.abs(half.pixels[3] - 128) <= 1);
  });
});

test("alpha epsilon snaps only when explicitly requested", () => {
  withCanvasEnvironment(() => {
    const nearOpaque = recoverTransparentCanvas(
      pixelCanvas(100, 100, 100),
      pixelCanvas(102, 102, 102),
      "#000000",
      "#ffffff"
    );
    const snappedOpaque = recoverTransparentCanvas(
      pixelCanvas(100, 100, 100),
      pixelCanvas(102, 102, 102),
      "#000000",
      "#ffffff",
      { alphaEpsilon: 3 }
    );
    const nearTransparent = recoverTransparentCanvas(
      pixelCanvas(1, 1, 1),
      pixelCanvas(254, 254, 254),
      "#000000",
      "#ffffff"
    );
    const snappedTransparent = recoverTransparentCanvas(
      pixelCanvas(1, 1, 1),
      pixelCanvas(254, 254, 254),
      "#000000",
      "#ffffff",
      { alphaEpsilon: 3 }
    );

    assert.equal(nearOpaque.pixels[3], 253);
    assert.equal(snappedOpaque.pixels[3], 255);
    assert.equal(nearTransparent.pixels[3], 2);
    assert.equal(snappedTransparent.pixels[3], 0);
  });
});

test("returns null when source sizes differ", () => {
  withCanvasEnvironment(() => {
    assert.equal(recoverTransparentCanvas(
      new FakeCanvas(1, 1),
      new FakeCanvas(2, 1),
      "#000000",
      "#ffffff"
    ), null);
  });
});
