import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS } from "../../web/js/core/settings_state.mjs";
import {
  buildInitialState,
  normalizeDialogState,
  normalizeScopeOpacity,
  toLastUsedState,
} from "../../web/js/ui/state.mjs";

test("normalizeScopeOpacity clamps values into the supported range", () => {
  assert.equal(normalizeScopeOpacity(-5), 0);
  assert.equal(normalizeScopeOpacity(250), 100);
  assert.equal(normalizeScopeOpacity("bad"), 40);
});

test("buildInitialState prefers last used values over defaults", () => {
  const state = buildInitialState({
    defaults: DEFAULTS,
    lastUsed: {
      format: "webp",
      background: "solid",
      scopeSelected: true,
      scopeOpacity: 75,
    },
    debugEnabled: true,
  });

  assert.equal(state.format, "webp");
  assert.equal(state.background, "solid");
  assert.equal(state.scopeSelected, true);
  assert.equal(state.scopeOpacity, 75);
  assert.equal(state.debug, true);
});

test("buildInitialState falls back when last used contains unsupported format", () => {
  const state = buildInitialState({
    defaults: DEFAULTS,
    lastUsed: { format: "svg" },
    debugEnabled: false,
  });

  assert.equal(state.format, "png");
  assert.equal(state.scopeSelected, false);
  assert.equal(state.scopeOpacity, 40);
});

test("normalizeDialogState keeps dialog-only fields alongside normalized export settings", () => {
  const state = normalizeDialogState(
    {
      format: "webp",
      scopeSelected: 1,
      scopeOpacity: 120,
    },
    { debugEnabled: true }
  );

  assert.equal(state.format, "webp");
  assert.equal(state.scopeSelected, true);
  assert.equal(state.scopeOpacity, 100);
  assert.equal(state.debug, true);
});

test("toLastUsedState serializes only normalized export and scope values", () => {
  const state = toLastUsedState({
    format: "svg",
    background: "solid",
    scopeSelected: "yes",
    scopeOpacity: -1,
    debug: true,
  });

  assert.deepEqual(state, {
    format: "png",
    embedWorkflow: true,
    background: "solid",
    solidColor: "#1f1f1f",
    nodeOpacity: 100,
    padding: 100,
    outputResolution: "auto",
    maxLongEdge: 4096,
    exceedMode: "tile",
    pngCompression: 7,
    scopeSelected: true,
    scopeOpacity: 0,
  });
  assert.equal("debug" in state, false);
});
