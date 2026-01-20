import { app } from "/scripts/app.js";

function collectGraphBounds(graph) {
  const rects = [];
  const nodes = graph?._nodes || graph?.nodes || [];
  const groups = graph?._groups || graph?.groups || [];

  nodes.forEach((node) => {
    if (!node) return;
    const pos = node.pos || node._pos || [0, 0];
    const size = node.size || node._size || [140, 30];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
    });
  });

  groups.forEach((group) => {
    if (!group) return;
    const pos = group.pos || group._pos || [0, 0];
    const size = group.size || group._size || [140, 80];
    if (!pos || pos.length < 2 || !size || size.length < 2) return;
    rects.push({
      left: pos[0],
      top: pos[1],
      right: pos[0] + size[0],
      bottom: pos[1] + size[1],
    });
  });

  if (!rects.length) {
    return null;
  }

  let left = rects[0].left;
  let top = rects[0].top;
  let right = rects[0].right;
  let bottom = rects[0].bottom;
  for (let i = 1; i < rects.length; i += 1) {
    const rect = rects[i];
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function applyPadding(bounds, padding) {
  if (!bounds) return null;
  const pad = Number.isFinite(padding) ? padding : 0;
  return {
    left: bounds.left - pad,
    top: bounds.top - pad,
    right: bounds.right + pad,
    bottom: bounds.bottom + pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2,
  };
}

function toBlobAsync(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create blob."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

export async function captureLegacy(options = {}) {
  const format = options.format || "png";
  const mime = format === "webp" ? "image/webp" : "image/png";
  const padding = Number(options.padding) || 0;

  const canvas = app?.canvas;
  const graph = app?.graph;
  if (!canvas || !graph) {
    throw new Error("Legacy capture: app.canvas or app.graph missing.");
  }

  const graphBounds = collectGraphBounds(graph);
  const bounds = applyPadding(graphBounds, padding);
  if (!bounds) {
    throw new Error("Legacy capture: bounds not available.");
  }

  const target = canvas.canvas;
  const prev = {
    width: target.width,
    height: target.height,
    dsScale: canvas.ds?.scale,
    dsOffset: canvas.ds?.offset ? [...canvas.ds.offset] : null,
  };

  const width = Math.max(1, Math.ceil(bounds.width));
  const height = Math.max(1, Math.ceil(bounds.height));

  target.width = width;
  target.height = height;
  if (canvas.ds) {
    canvas.ds.scale = 1;
    canvas.ds.offset = [-bounds.left, -bounds.top];
  }

  canvas.draw(true, true);
  const blob = await toBlobAsync(target, mime);

  target.width = prev.width;
  target.height = prev.height;
  if (canvas.ds && prev.dsOffset) {
    canvas.ds.scale = prev.dsScale;
    canvas.ds.offset = [...prev.dsOffset];
  }
  canvas.draw(true, true);

  return {
    type: "raster",
    mime,
    blob,
    width,
    height,
  };
}
