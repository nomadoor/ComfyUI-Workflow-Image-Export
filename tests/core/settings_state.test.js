import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, normalizeState } from "../../web/js/core/settings_state.js";

test("normalizeState falls back to png when legacy svg format is encountered", () => {
  const state = normalizeState({ format: "svg" });
  assert.equal(state.format, "png");
});

test("normalizeState preserves supported webp format", () => {
  const state = normalizeState({ format: "webp" });
  assert.equal(state.format, "webp");
});

test("normalizeState keeps embed workflow enabled by default when missing", () => {
  const state = normalizeState({});
  assert.equal(state.embedWorkflow, true);
});

test("normalizeState still coerces an explicitly provided embed workflow value", () => {
  const state = normalizeState({ embedWorkflow: 0 });
  assert.equal(state.embedWorkflow, false);
});

test("normalizeState clamps png compression and keeps sane defaults", () => {
  const state = normalizeState({
    pngCompression: 99,
    nodeOpacity: -1,
    padding: "oops",
  });
  assert.equal(state.pngCompression, 9);
  assert.equal(state.nodeOpacity, DEFAULTS.nodeOpacity);
  assert.equal(state.padding, DEFAULTS.padding);
});
