function normalizeScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export function resolveTiledOutputSize(bbox, renderScale = 1) {
  const scale = normalizeScale(renderScale);
  const graphWidth = Math.max(1, Math.ceil(Number(bbox?.width) || 0));
  const graphHeight = Math.max(1, Math.ceil(Number(bbox?.height) || 0));
  return {
    baseWidth: graphWidth,
    baseHeight: graphHeight,
    scale,
    width: Math.max(1, Math.ceil(graphWidth * scale)),
    height: Math.max(1, Math.ceil(graphHeight * scale)),
  };
}

export function resolveTileGeometry({
  tileOutputX,
  tileOutputY,
  tileOutputWidth,
  tileOutputHeight,
  outputWidth,
  outputHeight,
  renderScale = 1,
  bleedGraph = 64,
} = {}) {
  const scale = normalizeScale(renderScale);
  const bleedOutput = Math.max(0, Number(bleedGraph) || 0) * scale;
  const expandedOutputX = Math.floor(Math.max(0, tileOutputX - bleedOutput));
  const expandedOutputY = Math.floor(Math.max(0, tileOutputY - bleedOutput));
  const expandedOutputRight = Math.ceil(Math.min(
    outputWidth,
    tileOutputX + tileOutputWidth + bleedOutput
  ));
  const expandedOutputBottom = Math.ceil(Math.min(
    outputHeight,
    tileOutputY + tileOutputHeight + bleedOutput
  ));
  const expandedOutputWidth = Math.max(1, expandedOutputRight - expandedOutputX);
  const expandedOutputHeight = Math.max(1, expandedOutputBottom - expandedOutputY);
  return {
    tileGraphRect: {
      x: expandedOutputX / scale,
      y: expandedOutputY / scale,
      width: expandedOutputWidth / scale,
      height: expandedOutputHeight / scale,
    },
    cropOutputRect: {
      x: tileOutputX - expandedOutputX,
      y: tileOutputY - expandedOutputY,
      width: tileOutputWidth,
      height: tileOutputHeight,
    },
  };
}

export function resolveTileTransform({
  bbox,
  padding = 0,
  renderScale = 1,
  tileGraphRect = null,
} = {}) {
  const safePadding = Number(padding) || 0;
  const minX = Number(bbox?.minX) || 0;
  const minY = Number(bbox?.minY) || 0;
  const tileGraphX = Number(tileGraphRect?.x) || 0;
  const tileGraphY = Number(tileGraphRect?.y) || 0;
  return {
    scale: normalizeScale(renderScale),
    offset: [
      -minX + safePadding - tileGraphX,
      -minY + safePadding - tileGraphY,
    ],
  };
}
