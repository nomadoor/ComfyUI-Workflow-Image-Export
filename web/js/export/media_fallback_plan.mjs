import { toNodeIdKey } from "../core/node_ids.mjs";

export function buildMediaFallbackTargets(plan) {
  const targets = new Map();
  for (const entry of Array.isArray(plan) ? plan : []) {
    if (entry?.source !== "media" || !entry.graphRect) continue;
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null || targets.has(nodeId)) continue;
    targets.set(nodeId, {
      key: entry.key,
      graphRect: { ...entry.graphRect },
    });
  }
  return targets;
}

export function resolveMediaFallbackRect({ target, bounds, scale } = {}) {
  const graphRect = target?.graphRect;
  const safeScale = Number(scale);
  const left = Number(bounds?.left);
  const top = Number(bounds?.top);
  const x = Number(graphRect?.x ?? graphRect?.left);
  const y = Number(graphRect?.y ?? graphRect?.top);
  const w = Number(graphRect?.w ?? graphRect?.width);
  const h = Number(graphRect?.h ?? graphRect?.height);
  if (
    !(safeScale > 0) ||
    ![left, top, x, y, w, h].every(Number.isFinite) ||
    w <= 0 ||
    h <= 0
  ) {
    return null;
  }
  return {
    previewRect: {
      x: (x - left) * safeScale,
      y: (y - top) * safeScale,
      w: w * safeScale,
      h: h * safeScale,
    },
    coverageGraphRect: { x, y, w, h },
  };
}
