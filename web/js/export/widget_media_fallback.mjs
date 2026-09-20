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

function positionOffset(value, freeSpace) {
  // Computed length-percentage sums retain calc() until the available space is
  // known. Resolve only numeric %/px terms, never execute a CSS expression.
  const sum = /^calc\(\s*(.+?)\s+([+-])\s+(.+?)\s*\)$/.exec(value || "");
  const terms = sum ? [sum[1], `${sum[2]}${sum[3]}`] : [value];
  let offset = 0;
  for (const term of terms) {
    const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(%|px)$/.exec(term || "");
    if (!match) return freeSpace / 2;
    const amount = Number(match[1]);
    offset += match[2] === "%" ? freeSpace * amount / 100 : amount;
  }
  return Number.isFinite(offset) ? offset : freeSpace / 2;
}

function getVideoContentRect(entry, snapshot) {
  const rect = entry.graphRect;
  const isVideo = Number(entry.element?.videoWidth) > 0 &&
    Number(entry.element?.videoHeight) > 0;
  // A frame snapshot has no CSS. Restore the video's contained content inside
  // its widget box, rather than stretching the frame over the letterbox space.
  if (!isVideo || (entry.style?.objectFit || "contain") !== "contain") return rect;
  const fit = Math.min(rect.w / snapshot.width, rect.h / snapshot.height);
  const w = snapshot.width * fit;
  const h = snapshot.height * fit;
  // Spaces inside a computed calc() belong to that axis, not to the separator.
  const position = String(entry.style?.objectPosition || "").trim()
    .match(/^(calc\([^()]*\)|[^\s()]+)\s+(calc\([^()]*\)|[^\s()]+)$/)?.slice(1) || [];
  return {
    x: rect.x + positionOffset(position[0], rect.w - w),
    y: rect.y + positionOffset(position[1], rect.h - h),
    w,
    h,
  };
}

export async function snapshotPlannedWidgetMedia({
  plan,
  mediaSnapshotCache,
} = {}) {
  const cache = mediaSnapshotCache instanceof Map ? mediaSnapshotCache : new Map();
  const entries = (Array.isArray(plan) ? plan : []).filter((entry) =>
    entry?.source === "media" && entry?.key && entry?.element
  );
  await Promise.all(entries.map((entry) => resolveMediaSnapshot(
    cache,
    "widget",
    entry.mediaCacheKey || entry.key,
    async () => entry.element,
    createOriginCleanMediaSnapshot
  )));
  return cache;
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
      entry.mediaCacheKey || entry.key,
      async () => entry.element,
      createOriginCleanMediaSnapshot
    );
    if (!snapshot) {
      missing += 1;
      continue;
    }

    const contentRect = getVideoContentRect(entry, snapshot);
    const exportRect = {
      x: (contentRect.x - Number(bounds.left)) * safeScale,
      y: (contentRect.y - Number(bounds.top)) * safeScale,
      w: contentRect.w * safeScale,
      h: contentRect.h * safeScale,
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
