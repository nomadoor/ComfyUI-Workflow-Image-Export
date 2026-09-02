import test from "node:test";
import assert from "node:assert/strict";

import { graphPointToCanvas } from "../../web/js/core/graph_transform.mjs";
import {
  resolveTileGeometry,
  resolveTileTransform,
  resolveTiledOutputSize,
} from "../../web/js/export/tile_plan.mjs";

test("scaled tile graph origin maps to the tile-local canvas origin", () => {
  const bbox = {
    minX: 100,
    minY: 50,
    paddedMinX: 90,
    paddedMinY: 40,
  };
  const geometry = resolveTileGeometry({
    tileOutputX: 2048,
    tileOutputY: 2048,
    tileOutputWidth: 2048,
    tileOutputHeight: 1024,
    outputWidth: 10000,
    outputHeight: 6000,
    renderScale: 2,
    bleedGraph: 64,
  });
  const tileGraphRect = geometry.tileGraphRect;

  assert.deepEqual(tileGraphRect, { x: 960, y: 960, width: 1152, height: 640 });

  const transform = resolveTileTransform({
    bbox,
    padding: 10,
    renderScale: 2,
    tileGraphRect,
  });

  assert.deepEqual(transform, {
    scale: 2,
    offset: [-1050, -1000],
  });
  assert.deepEqual(
    graphPointToCanvas(
      [bbox.paddedMinX + tileGraphRect.x, bbox.paddedMinY + tileGraphRect.y],
      transform
    ),
    [0, 0]
  );
});

test("fractional scaled tiles retain graph-space offsets", () => {
  const bbox = {
    minX: -200,
    minY: 300,
    paddedMinX: -216,
    paddedMinY: 284,
  };
  const tileGraphRect = { x: 4934.08203125, y: 0, width: 1000, height: 800 };

  const transform = resolveTileTransform({
    bbox,
    padding: 16,
    renderScale: 0.4096,
    tileGraphRect,
  });

  assert.deepEqual(
    graphPointToCanvas(
      [bbox.paddedMinX + tileGraphRect.x, bbox.paddedMinY],
      transform
    ),
    [0, 0]
  );
});

test("fractional final-tile crops stay inside their rendered tile canvases", () => {
  for (const { graphWidth, graphHeight, scale } of [
    { graphWidth: 10001, graphHeight: 5001, scale: 0.4096 },
    { graphWidth: 3333, graphHeight: 2222, scale: 1.25 },
    { graphWidth: 2500, graphHeight: 1300, scale: 2 },
  ]) {
    const output = resolveTiledOutputSize({ width: graphWidth, height: graphHeight }, scale);
    const tileOutputX = Math.floor((output.width - 1) / 2048) * 2048;
    const tileOutputY = Math.floor((output.height - 1) / 2048) * 2048;
    const tileOutputWidth = output.width - tileOutputX;
    const tileOutputHeight = output.height - tileOutputY;
    const geometry = resolveTileGeometry({
      tileOutputX,
      tileOutputY,
      tileOutputWidth,
      tileOutputHeight,
      outputWidth: output.width,
      outputHeight: output.height,
      renderScale: scale,
      bleedGraph: 64,
    });
    const renderedWidth = Math.ceil(geometry.tileGraphRect.width * scale);
    const renderedHeight = Math.ceil(geometry.tileGraphRect.height * scale);

    assert.ok(
      geometry.cropOutputRect.x + geometry.cropOutputRect.width <= renderedWidth,
      `horizontal crop at scale ${scale}`
    );
    assert.ok(
      geometry.cropOutputRect.y + geometry.cropOutputRect.height <= renderedHeight,
      `vertical crop at scale ${scale}`
    );
  }
});
