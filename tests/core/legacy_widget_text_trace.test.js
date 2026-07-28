import assert from "node:assert/strict";
import test from "node:test";

import {
  createWidgetTextTrace,
  matchesTargetText,
} from "../../web/js/core/backends/legacy_widget_text_trace.mjs";

test("matches exact text, complete lines, and wrapped fragments", () => {
  assert.equal(matchesTargetText("alpha\nbeta", "alpha\nbeta"), true);
  assert.equal(matchesTargetText("beta", "alpha\nbeta"), true);
  assert.equal(matchesTargetText("long fragment", "a long fragment of widget text"), true);
  assert.equal(matchesTargetText("a", "a longer value"), false);
  assert.equal(matchesTargetText("other", "widget text"), false);
});

test("traces matching context text calls by stage and restores methods", () => {
  const rawCalls = [];
  const logs = [];
  const originalFillText = function fillText(text, x, y) {
    rawCalls.push({ text, x, y });
  };
  const ctx = {
    fillText: originalFillText,
    strokeText() {},
    font: "12px sans-serif",
    fillStyle: "#fff",
    strokeStyle: "#000",
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 };
    },
  };
  const trace = createWidgetTextTrace({
    ctx,
    plan: [{ key: "72:0", text: "unique widget value" }],
    debugLog(label, payload) {
      logs.push({ label, payload });
    },
  });

  trace.setStage("offscreen.draw");
  ctx.fillText("unique widget value", 4, 5);
  ctx.fillText("unrelated", 6, 7);

  assert.deepEqual(rawCalls, [
    { text: "unique widget value", x: 4, y: 5 },
    { text: "unrelated", x: 6, y: 7 },
  ]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].label, "widget.text.trace");
  assert.equal(logs[0].payload.stage, "offscreen.draw");
  assert.deepEqual(logs[0].payload.matchingKeys, ["72:0"]);
  assert.deepEqual(trace.summary().byStage, { "offscreen.draw": 1 });

  trace.restore();
  assert.equal(ctx.fillText, originalFillText);
});
