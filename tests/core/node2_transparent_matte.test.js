import assert from "node:assert/strict";
import test from "node:test";

import {
  captureTwoFrameTransparentMatte,
  getNode2TransparentWarning,
  summarizeNode2TransparentTileRecovery,
} from "../../web/js/core/backends/node2_transparent_matte.mjs";

function frame(signature, canvas = { signature }) {
  return {
    canvas,
    frame: {
      signature,
      blobOk: true,
    },
  };
}

test("captures a strict black/white pair after a disposable white baseline", async () => {
  const colors = [];
  const strictCalls = [];
  const matte = { transparent: true };
  const captures = [frame("black"), frame("white")];

  const result = await captureTwoFrameTransparentMatte({
    colorA: "#000000",
    colorB: "#ffffff",
    setColor(color) {
      colors.push(color);
    },
    seedBaseline() {
      return { signature: "baseline-white" };
    },
    captureChanged(options) {
      strictCalls.push(options.strictChangedFrame);
      return captures.shift();
    },
    recover() {
      return matte;
    },
    isTransparent(canvas) {
      return canvas.transparent === true;
    },
  });

  assert.deepEqual(colors, ["#ffffff", "#000000", "#ffffff"]);
  assert.deepEqual(strictCalls, [true, true]);
  assert.equal(result.canvas, matte);
  assert.deepEqual(result.transparentRecovery, {
    attempted: true,
    ok: true,
    fallback: null,
  });
});

test("unchanged second frame falls back to the captured black frame", async () => {
  const blackCanvas = { name: "black" };
  const captures = [
    frame("black", blackCanvas),
    frame("black", { name: "stale-white" }),
  ];

  const result = await captureTwoFrameTransparentMatte({
    colorA: "#000000",
    colorB: "#ffffff",
    async setColor() {},
    async seedBaseline() {
      return { signature: "baseline-white" };
    },
    async captureChanged() {
      return captures.shift();
    },
    cropCanvas(canvas) {
      return canvas;
    },
    recover() {
      throw new Error("must not recover identical frames");
    },
    isTransparent() {
      return false;
    },
  });

  assert.equal(result.canvas, blackCanvas);
  assert.equal(result.transparentRecovery.ok, false);
  assert.equal(result.transparentRecovery.fallback, "black-frame");
});

test("strict second-frame timeout falls back to the captured black frame", async () => {
  const blackCanvas = { name: "black" };
  let calls = 0;
  const result = await captureTwoFrameTransparentMatte({
    colorA: "#000000",
    colorB: "#ffffff",
    async setColor() {},
    async seedBaseline() {
      return { signature: "baseline-white" };
    },
    async captureChanged() {
      calls += 1;
      if (calls === 1) return frame("black", blackCanvas);
      throw new Error("changed video frame unavailable");
    },
    recover() {
      throw new Error("must not recover without frame B");
    },
    isTransparent() {
      return false;
    },
  });

  assert.equal(result.canvas, blackCanvas);
  assert.equal(result.transparentRecovery.ok, false);
  assert.match(result.transparentRecovery.error, /changed video frame unavailable/);
});

test("opaque recovery falls back and records a recovery warning state", async () => {
  const blackCanvas = { name: "black" };
  const captures = [
    frame("black", blackCanvas),
    frame("white", { name: "white" }),
  ];

  const result = await captureTwoFrameTransparentMatte({
    colorA: "#000000",
    colorB: "#ffffff",
    async setColor() {},
    async seedBaseline() {
      return { signature: "baseline-white" };
    },
    async captureChanged() {
      return captures.shift();
    },
    recover() {
      return { transparent: false };
    },
    isTransparent(canvas) {
      return canvas.transparent;
    },
  });

  assert.equal(result.canvas, blackCanvas);
  assert.equal(result.transparentRecovery.ok, false);
  assert.match(result.transparentRecovery.error, /opaque/);
});

test("transparent warning distinguishes successful recovery, failed recovery, and unsupported tile capture", () => {
  assert.equal(getNode2TransparentWarning(
    { background: "transparent" },
    { transparentRecovery: { attempted: true, ok: true } }
  ), null);
  assert.equal(getNode2TransparentWarning(
    { background: "transparent" },
    { transparentRecovery: { attempted: true, ok: false } }
  ), "node2:transparent_recovery_failed");
  assert.equal(getNode2TransparentWarning(
    { background: "transparent" },
    {
      frame: { tiled: true },
      transparentRecovery: { attempted: true, ok: true },
    }
  ), null);
  assert.equal(getNode2TransparentWarning(
    { background: "transparent" },
    { frame: { tiled: true } }
  ), "node2:transparent_background_unsupported");
});

test("summarizes transparent tile recovery without hiding partial fallback", () => {
  assert.deepEqual(summarizeNode2TransparentTileRecovery(0, 6), {
    attempted: true,
    ok: true,
    fallback: null,
    failedTiles: 0,
    totalTiles: 6,
  });
  assert.deepEqual(summarizeNode2TransparentTileRecovery(2, 6), {
    attempted: true,
    ok: false,
    fallback: "black-frame",
    failedTiles: 2,
    totalTiles: 6,
  });
});
