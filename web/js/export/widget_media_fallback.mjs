import { toNodeIdKey } from "../core/node_ids.mjs";
import {
  createOriginCleanMediaSnapshot,
  resolveMediaSnapshot,
} from "./media_snapshot_cache.mjs?v=20260903-16";

function intersectGraphRects(a, b) {
  if (!a || !b) return null;
  const left = Math.max(Number(a.x), Number(b.x ?? b.left));
  const top = Math.max(Number(a.y), Number(b.y ?? b.top));
  const right = Math.min(
    Number(a.x) + Number(a.w),
    Number(b.right ?? (Number(b.x ?? b.left) + Number(b.w ?? b.width)))
  );
  const bottom = Math.min(
    Number(a.y) + Number(a.h),
    Number(b.bottom ?? (Number(b.y ?? b.top) + Number(b.h ?? b.height)))
  );
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, w: right - left, h: bottom - top };
}

function addCoverage(coverage, nodeId, graphRect) {
  const entries = coverage.get(nodeId) || [];
  entries.push({ ...graphRect });
  coverage.set(nodeId, entries);
}

export async function drawWidgetMediaFallbacks({
  exportCtx,
  plan,
  bounds,
  scale,
  mediaSnapshotCache,
  debugLog = null,
} = {}) {
  const coverage = new Map();
  const safeScale = Number(scale);
  if (!exportCtx || !bounds || !(safeScale > 0)) return coverage;
  const cache = mediaSnapshotCache instanceof Map ? mediaSnapshotCache : new Map();
  let drawn = 0;
  let missing = 0;
  let outside = 0;

  for (const entry of Array.isArray(plan) ? plan : []) {
    if (entry?.source !== "media" || !entry.key || !entry.element || !entry.graphRect) {
      continue;
    }
    const nodeId = toNodeIdKey(entry.nodeId);
    if (nodeId === null) continue;
    const nodeClipped = intersectGraphRects(entry.graphRect, entry.nodeGraphRect);
    const tileClipped = intersectGraphRects(nodeClipped, bounds);
    if (!tileClipped) {
      outside += 1;
      continue;
    }

    const snapshot = await resolveMediaSnapshot(
      cache,
      "widget",
      entry.key,
      async () => entry.element,
      createOriginCleanMediaSnapshot
    );
    if (!snapshot) {
      missing += 1;
      continue;
    }

    const exportRect = {
      x: (entry.graphRect.x - Number(bounds.left)) * safeScale,
      y: (entry.graphRect.y - Number(bounds.top)) * safeScale,
      w: entry.graphRect.w * safeScale,
      h: entry.graphRect.h * safeScale,
    };
    const clipRect = {
      x: (tileClipped.x - Number(bounds.left)) * safeScale,
      y: (tileClipped.y - Number(bounds.top)) * safeScale,
      w: tileClipped.w * safeScale,
      h: tileClipped.h * safeScale,
    };

    let ok = false;
    exportCtx.save?.();
    try {
      exportCtx.beginPath?.();
      exportCtx.rect?.(clipRect.x, clipRect.y, clipRect.w, clipRect.h);
      exportCtx.clip?.();
      exportCtx.drawImage(
        snapshot,
        exportRect.x,
        exportRect.y,
        exportRect.w,
        exportRect.h
      );
      ok = true;
    } catch (_) {
      ok = false;
    } finally {
      exportCtx.restore?.();
    }

    if (ok) {
      drawn += 1;
      addCoverage(coverage, nodeId, entry.graphRect);
    } else {
      missing += 1;
    }
  }

  debugLog?.("widget.media.fallback", { drawn, missing, outside });
  return coverage;
}
