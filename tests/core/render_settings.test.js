import assert from "node:assert/strict";
import test from "node:test";

import { copyRenderSettings } from "../../web/js/core/render_settings.mjs";
import { copyRenderSettings as copyLegacyRenderSettings } from "../../web/js/core/backends/legacy_support.mjs";

const renderSettingCopiers = [
  ["shared", copyRenderSettings],
  ["Classic", copyLegacyRenderSettings],
];

for (const [name, copySettings] of renderSettingCopiers) {
  test(`${name} export preserves the current LiteGraph link render mode`, () => {
    const sourceCanvas = { links_render_mode: 2 };
    const exportCanvas = {};

    copySettings(sourceCanvas, exportCanvas);

    assert.equal(exportCanvas.links_render_mode, 2);
  });
}

test("render settings preserve the falsy straight-link mode", () => {
  const exportCanvas = {};

  copyRenderSettings({ links_render_mode: 0 }, exportCanvas);

  assert.equal(exportCanvas.links_render_mode, 0);
});

test("render settings fall back to LiteGraph constructor defaults", () => {
  const exportCanvas = {};
  const sourceCanvas = {
    constructor: { links_render_mode: 1 },
  };

  copyRenderSettings(sourceCanvas, exportCanvas);

  assert.equal(exportCanvas.links_render_mode, 1);
});
