import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  copyRenderSettings,
  disableExportLevelOfDetail,
} from "../../web/js/core/render_settings.mjs";
import {
  copyRenderSettings as copyLegacyRenderSettings,
  disableExportLevelOfDetail as disableLegacyExportLevelOfDetail,
} from "../../web/js/core/backends/legacy_support.mjs";

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

// Mirrors the level-of-detail contract of comfyui-frontend-package 1.52.7.
// Assigning ds.scale does not notify the canvas, but draw() calls
// ds.computeVisibleArea(), which reports the changed scale through onChanged.
class LiteGraphCanvasFixture {
  constructor({ nodeTextSize = 14, devicePixelRatio = 1 } = {}) {
    this.nodeTextSize = nodeTextSize;
    this.devicePixelRatio = devicePixelRatio;
    this._min_font_size_for_lod = 8;
    this._lowQualityZoomThreshold = 0;
    this._isLowQuality = false;
    this.ds = {
      state: { scale: 1, offset: [0, 0] },
      lastState: { scale: 0, offset: [0, 0] },
      onChanged: null,
      get scale() {
        return this.state.scale;
      },
      set scale(value) {
        this.state.scale = value;
      },
      computeVisibleArea() {
        const { state, lastState } = this;
        const changed =
          state.scale !== lastState.scale ||
          state.offset[0] !== lastState.offset[0] ||
          state.offset[1] !== lastState.offset[1];
        if (!changed) return;
        this.onChanged?.(state.scale, state.offset);
        lastState.scale = state.scale;
        lastState.offset = [...state.offset];
      },
    };
    this.updateLowQualityThreshold();
    this.ds.onChanged = (scale) => {
      if (this._lowQualityZoomThreshold > 0) {
        this._isLowQuality = scale < this._lowQualityZoomThreshold;
      }
    };
  }

  get min_font_size_for_lod() {
    return this._min_font_size_for_lod;
  }

  set min_font_size_for_lod(value) {
    if (this._min_font_size_for_lod === value) return;
    this._min_font_size_for_lod = value;
    this.updateLowQualityThreshold();
  }

  updateLowQualityThreshold() {
    if (this._min_font_size_for_lod === 0) {
      this._lowQualityZoomThreshold = 0;
      this._isLowQuality = false;
      return;
    }
    this._lowQualityZoomThreshold =
      this._min_font_size_for_lod / (this.nodeTextSize * Math.sqrt(this.devicePixelRatio));
    this._isLowQuality = this.ds.scale < this._lowQualityZoomThreshold;
  }

  get low_quality() {
    return this._isLowQuality;
  }

  draw() {
    this.ds.computeVisibleArea();
  }
}

test("LiteGraph switches a downscaled export canvas to low quality by default", () => {
  const canvas = new LiteGraphCanvasFixture();

  canvas.ds.scale = 0.539;
  canvas.draw();

  assert.equal(canvas.low_quality, true);
});

const levelOfDetailDisablers = [
  ["shared", disableExportLevelOfDetail],
  ["Classic", disableLegacyExportLevelOfDetail],
];

for (const [name, disableLevelOfDetail] of levelOfDetailDisablers) {
  for (const scale of [0.539, 0.5, 0.25]) {
    test(`${name} export keeps full-detail drawing at ${scale}x`, () => {
      const canvas = new LiteGraphCanvasFixture();

      assert.equal(disableLevelOfDetail(canvas), true);
      canvas.ds.scale = scale;
      canvas.draw();

      assert.equal(canvas.low_quality, false);
    });
  }
}

test("disabling export LOD clears low quality that is already active", () => {
  const canvas = new LiteGraphCanvasFixture();
  canvas.ds.scale = 0.25;
  canvas.draw();
  assert.equal(canvas.low_quality, true);

  disableExportLevelOfDetail(canvas);
  assert.equal(canvas.low_quality, false);

  canvas.ds.scale = 0.2;
  canvas.draw();
  assert.equal(canvas.low_quality, false);
});

test("export LOD is left untouched on canvases without LiteGraph LOD support", () => {
  const canvas = {};

  assert.equal(disableExportLevelOfDetail(canvas), false);
  assert.equal(Object.hasOwn(canvas, "min_font_size_for_lod"), false);
});

async function readSource(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

function assertOrdered(source, markers, label) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker, cursor + 1);
    assert.ok(index > cursor, `${label}: expected "${marker}" after the previous step`);
    cursor = index;
  }
}

test("both Classic renderers disable LOD after copying live settings and before drawing", async () => {
  assertOrdered(
    await readSource("web/js/core/backends/legacy_capture.mjs"),
    [
      "copyRenderSettings(uiCanvas, offscreen);",
      "disableExportLevelOfDetail(offscreen);",
      "drawOffscreen(offscreen",
    ],
    "live renderer"
  );
  assertOrdered(
    await readSource("web/js/export/render_graph_offscreen.mjs"),
    [
      "copyRenderSettings(app?.canvas, offscreen);",
      "disableExportLevelOfDetail(offscreen);",
      "offscreen.draw(",
    ],
    "tiled renderer"
  );
});
