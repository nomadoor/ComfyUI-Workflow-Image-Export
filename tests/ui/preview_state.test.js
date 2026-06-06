import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPreviewState,
  getPreviewMime,
  getPreviewStateKey,
} from "../../web/js/ui/preview_state.mjs";
import { PREVIEW_MAX_PIXELS } from "../../web/js/export/limits.mjs";

test("buildPreviewState forces preview-safe export options", () => {
  const state = buildPreviewState({
    state: {
      format: "png",
      embedWorkflow: true,
      outputResolution: "200%",
      maxLongEdge: 4096,
      padding: 100,
    },
    selectedNodeIds: [3, 9],
    workflowJsonText: "{\"nodes\":[]}",
  });

  assert.equal(state.format, "png");
  assert.equal(state.embedWorkflow, false);
  assert.equal(state.outputResolution, "100%");
  assert.equal(state.maxLongEdge, 0);
  assert.deepEqual(state.selectedNodeIds, [3, 9]);
  assert.equal(state.previewFast, true);
  assert.equal(state.previewMaxPixels, PREVIEW_MAX_PIXELS);
  assert.equal(typeof state.workflowSignature, "string");
  assert.equal(state.workflowJsonText, "{\"nodes\":[]}");
});

test("buildPreviewState keeps webp previews as webp and coerces other formats to png", () => {
  assert.equal(buildPreviewState({ state: { format: "webp" } }).format, "webp");
  assert.equal(buildPreviewState({ state: { format: "svg" } }).format, "png");
});

test("getPreviewStateKey includes visual inputs and workflow signature only", () => {
  const base = {
    format: "png",
    background: "solid",
    solidColor: "#123456",
    padding: 100,
    nodeOpacity: 100,
    scopeSelected: false,
    scopeOpacity: 40,
    selectedNodeIds: [1],
    workflowSignature: "abc",
    workflowJsonText: "large payload",
  };

  const key = getPreviewStateKey(base);
  const sameKey = getPreviewStateKey({ ...base, workflowJsonText: "changed" });
  const changedKey = getPreviewStateKey({ ...base, padding: 120 });

  assert.equal(key, sameKey);
  assert.notEqual(key, changedKey);
});

test("getPreviewMime resolves raster preview mime", () => {
  assert.equal(getPreviewMime({ format: "webp" }), "image/webp");
  assert.equal(getPreviewMime({ format: "png" }), "image/png");
});
