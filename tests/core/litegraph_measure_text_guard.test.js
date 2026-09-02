import assert from "node:assert/strict";
import test from "node:test";

import { createLiteGraphMeasureTextGuard } from "../../web/js/core/backends/litegraph_measure_text_guard.mjs";

test("LiteGraph measure-text guard restores the exact static function", () => {
  const original = () => 123;
  const offscreen = () => 456;
  const LGraphCanvasRef = {};
  Object.defineProperty(LGraphCanvasRef, "_measureText", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: original,
  });
  const guard = createLiteGraphMeasureTextGuard(LGraphCanvasRef);

  LGraphCanvasRef._measureText = offscreen;
  guard.restore();
  guard.restore();

  assert.equal(LGraphCanvasRef._measureText, original);
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(LGraphCanvasRef, "_measureText"),
    {
      configurable: true,
      enumerable: false,
      writable: true,
      value: original,
    }
  );
});

test("LiteGraph measure-text guard restores an originally absent property", () => {
  const LGraphCanvasRef = {};
  const guard = createLiteGraphMeasureTextGuard(LGraphCanvasRef);

  LGraphCanvasRef._measureText = () => 456;
  guard.restore();

  assert.equal(Object.hasOwn(LGraphCanvasRef, "_measureText"), false);
});

test("LiteGraph measure-text guard restores a base constructor through a subclass", () => {
  const original = () => 123;
  class BaseCanvas {}
  class CustomCanvas extends BaseCanvas {}
  BaseCanvas._measureText = original;
  const guard = createLiteGraphMeasureTextGuard(CustomCanvas);

  BaseCanvas._measureText = () => 456;
  guard.restore();

  assert.equal(BaseCanvas._measureText, original);
  assert.equal(Object.hasOwn(CustomCanvas, "_measureText"), false);
});
