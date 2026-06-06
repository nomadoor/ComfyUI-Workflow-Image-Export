import { app } from "/scripts/app.js";
import {
  getCanvasRoot,
  getDomElementGraphRect,
  isElementInGraphNode,
} from "../core/overlays/dom_utils.mjs";
import {
  buildDomMediaByNodeId,
  buildDomMediaByOverlap,
  buildViewUrl,
  captureFromDomMedia,
  captureVideoFrame,
  computePreviewRect,
  drawVideoPlaceholder,
  extractBackgroundImageUrl,
  extractFileRefFromNode,
  findLiveNodeById,
  isImageNode,
  isVideoNode,
  loadImageCached,
  lastVideoSrcByNodeId,
  normalizeSelectedNodeIds,
  resolveImageDrawable,
  resolveVideoDrawable,
  sanitizeMediaUrl,
  selectDomMedia,
  shouldRenderResolvedNode,
} from "./fallback_media_helpers.mjs";

export async function drawVideoThumbnails({
  exportCtx,
  graph,
  nodeRects,
  bounds,
  scale,
  debugLog,
  skipNodeIds = null,
  drawPlaceholderOnMiss = true,
  selectedNodeIds = null,
  renderFilter = "all",
}) {
  const selectedIdSet = normalizeSelectedNodeIds(selectedNodeIds);
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) return;
  const videoNodes = nodes.filter((node) => node && isVideoNode(node));
  if (!videoNodes.length) return;
  const rectById = new Map();
  for (const rect of nodeRects || []) {
    if (Number.isFinite(rect.id)) {
      rectById.set(rect.id, rect);
    }
  }

  let drawn = 0;
  let skippedNoDrawable = 0;
  let skippedNoRect = 0;
  let skippedEmptyRect = 0;
  let logged = 0;
  const domMediaById = buildDomMediaByNodeId(app?.canvas);
  const domMediaByOverlap = buildDomMediaByOverlap(nodeRects || [], app?.canvas);
  const allVideos = Array.from(document.querySelectorAll("video"));
  if (debugLog && logged < 1) {
    debugLog("video.thumbnail.dom_index", {
      domMedia: domMediaById.size,
      videos: allVideos.length,
    });
    logged += 1;
  }

  for (const node of videoNodes) {
    if (skipNodeIds?.has?.(node.id)) {
      continue;
    }
    if (!shouldRenderResolvedNode(node.id, selectedIdSet, renderFilter)) {
      continue;
    }
    const rect = rectById.get(node.id);
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    let drawable = resolveVideoDrawable(node);
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      if (liveNode) {
        drawable = resolveVideoDrawable(liveNode);
        if (drawable && debugLog && logged < 5) debugLog(`video.thumbnail.steal`, { id: node.id, type: "direct" });
      }
    }

    let directUrl = null;
    if (drawable instanceof HTMLVideoElement) {
      directUrl = sanitizeMediaUrl(drawable.currentSrc || drawable.src || null);
      const prevSrc = lastVideoSrcByNodeId.get(node.id);
      const ready = (drawable.readyState || 0) >= 2;
      const hasSize = (drawable.videoWidth || 0) > 1 && (drawable.videoHeight || 0) > 1;
      if (prevSrc && directUrl && prevSrc !== directUrl && !ready) {
        drawable = null;
      }
      if (drawable instanceof HTMLVideoElement) {
        const hasPoster = Boolean(drawable.poster);
        if (!hasSize && hasPoster) {
          drawable = await loadImageCached(drawable.poster);
        } else {
          const captured = captureVideoFrame(drawable);
          if (captured) {
            drawable = captured;
            if (directUrl) lastVideoSrcByNodeId.set(node.id, directUrl);
          } else if (drawable.readyState < 2 && hasPoster) {
            drawable = await loadImageCached(drawable.poster);
            if (directUrl) lastVideoSrcByNodeId.set(node.id, directUrl);
          } else {
            drawable = null;
          }
        }
      }
    }

    const liveNode = findLiveNodeById(node.id);
    const ref = extractFileRefFromNode(liveNode || node);
    const refFilename = typeof ref?.filename === "string" ? ref.filename : "";
    if (
      directUrl &&
      refFilename &&
      !directUrl.includes(encodeURIComponent(refFilename)) &&
      !directUrl.includes(refFilename)
    ) {
      directUrl = null;
    }
    if (!drawable) {
      const domMedia = selectDomMedia(node.id, domMediaById, domMediaByOverlap);
      drawable = await captureFromDomMedia(domMedia);
      if (drawable && debugLog && logged < 5) {
        debugLog("video.thumbnail.steal", {
          id: node.id,
          type: domMedia instanceof HTMLVideoElement ? "dom-video" : "dom-media",
        });
        logged += 1;
      }
    }
    if (!drawable && refFilename) {
      const matched = allVideos.find((video) => {
        const src = `${video.currentSrc || ""} ${video.src || ""}`;
        return src.includes(refFilename) || src.includes(encodeURIComponent(refFilename));
      });
      if (matched) {
        const srcKey = matched.currentSrc || matched.src || "";
        const prevSrc = lastVideoSrcByNodeId.get(node.id);
        const ready = (matched.readyState || 0) >= 2;
        const hasSize = (matched.videoWidth || 0) > 1 && (matched.videoHeight || 0) > 1;
        if (prevSrc && srcKey && prevSrc !== srcKey && !ready) {
          drawable = null;
        } else {
          const captured = ready && hasSize ? captureVideoFrame(matched) : null;
          if (captured) {
            drawable = captured;
            lastVideoSrcByNodeId.set(node.id, srcKey);
            if (debugLog && logged < 5) {
              debugLog("video.thumbnail.steal", { id: node.id, type: "dom-match" });
              logged += 1;
            }
          } else if (matched.poster) {
            drawable = await loadImageCached(matched.poster);
            lastVideoSrcByNodeId.set(node.id, srcKey);
          }
        }
      }
    }
    if (typeof drawable === "string") {
      drawable = null;
    }
    if (!drawable && debugLog && logged < 5) {
      debugLog("video.thumbnail.miss_detail", {
        id: node.id,
        title: node.title,
        type: node.type,
      });
      logged += 1;
    }

    const previewRect = computePreviewRect({ rect, node, bounds, scale });
    if (!previewRect) {
      skippedEmptyRect += 1;
      continue;
    }
    const { x, y, w, h } = previewRect;

    if (drawable) {
      try {
        const dw = drawable.videoWidth || drawable.width || drawable.naturalWidth || 0;
        const dh = drawable.videoHeight || drawable.height || drawable.naturalHeight || 0;
        if (dw > 0 && dh > 0) {
          const scaleFit = Math.min(w / dw, h / dh);
          const fitW = dw * scaleFit;
          const fitH = dh * scaleFit;
          const fitX = x + (w - fitW) / 2;
          const fitY = y + (h - fitH) / 2;
          exportCtx.drawImage(drawable, fitX, fitY, fitW, fitH);
        } else {
          exportCtx.drawImage(drawable, x, y, w, h);
        }
        drawn += 1;
      } catch (_) {}
    } else if (drawPlaceholderOnMiss) {
      skippedNoDrawable += 1;
      drawVideoPlaceholder(exportCtx, x, y, w, h);

      if (debugLog && logged < 5) {
        debugLog("video.thumbnail.miss", { id: node.id });
        logged += 1;
      }
    } else {
      skippedNoDrawable += 1;
    }
  }

  debugLog?.("video.thumbnail", {
    drawn,
    skippedNoDrawable,
    skippedNoRect,
    skippedEmptyRect,
  });
}

export async function drawImageThumbnails({ exportCtx, graph, nodeRects, bounds, scale, debugLog }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) return;
  const imageNodes = nodes.filter((node) => node && isImageNode(node) && !isVideoNode(node));
  if (!imageNodes.length) return;
  const rectById = new Map();
  for (const rect of nodeRects || []) {
    if (Number.isFinite(rect.id)) {
      rectById.set(rect.id, rect);
    }
  }

  let drawn = 0;
  let skippedNoDrawable = 0;
  let skippedNoRect = 0;
  let skippedEmptyRect = 0;
  let logged = 0;

  for (const node of imageNodes) {
    const rect = rectById.get(node.id);
    if (!rect) {
      skippedNoRect += 1;
      continue;
    }

    let drawable = resolveImageDrawable(node);
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      if (liveNode) {
        drawable = resolveImageDrawable(liveNode);
      }
    }
    if (typeof drawable === "string") {
      drawable = await loadImageCached(drawable);
    }
    if (!drawable) {
      const liveNode = findLiveNodeById(node.id);
      const ref = extractFileRefFromNode(liveNode || node);
      const url = buildViewUrl(ref, liveNode || node);
      if (url) {
        drawable = await loadImageCached(url);
      }
    }
    if (!drawable) {
      skippedNoDrawable += 1;
      if (debugLog && logged < 5) {
        debugLog("image.thumbnail.miss", {
          id: node.id,
          title: node.title,
          type: node.type,
          keys: Object.keys(node).filter((key) => /img|image|canvas|preview|tex/i.test(key)),
        });
        logged += 1;
      }
      continue;
    }

    const previewRect = computePreviewRect({ rect, node, bounds, scale });
    if (!previewRect) {
      skippedEmptyRect += 1;
      continue;
    }
    const { x, y, w, h, debug } = previewRect;

    if (debugLog && logged < 5) {
      debugLog("image.thumbnail.pos", {
        id: node.id,
        title: node.title,
        type: node.type,
        ...debug,
        drawRect: { x, y, w, h },
      });
    }

    try {
      const dw = drawable.width || drawable.naturalWidth || 0;
      const dh = drawable.height || drawable.naturalHeight || 0;
      if (dw > 0 && dh > 0) {
        const scaleFit = Math.min(w / dw, h / dh);
        const fitW = dw * scaleFit;
        const fitH = dh * scaleFit;
        const fitX = x + (w - fitW) / 2;
        const fitY = y + (h - fitH) / 2;
        exportCtx.drawImage(drawable, fitX, fitY, fitW, fitH);
      } else {
        exportCtx.drawImage(drawable, x, y, w, h);
      }
      drawn += 1;
    } catch (_) {}
  }

  debugLog?.("image.thumbnail", {
    drawn,
    skippedNoDrawable,
    skippedNoRect,
    skippedEmptyRect,
  });
}

export async function drawBackgroundImageOverlays({ exportCtx, uiCanvas, bounds, scale }) {
  const root = getCanvasRoot(uiCanvas);
  if (!root) return;
  const elements = root.querySelectorAll(".dom-widget, .dom-widget *");
  if (!elements.length) return;

  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isElementInGraphNode(el)) continue;
    const style = window.getComputedStyle(el);
    const bg = style?.backgroundImage;
    if (!bg || bg === "none") continue;
    if (bg.includes("gradient(")) continue;

    const url = extractBackgroundImageUrl(bg);
    if (!url) continue;

    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect) continue;
    if (rect.w > bounds.width * 1.05 || rect.h > bounds.height * 1.05) {
      continue;
    }

    const img = await loadImageCached(url);
    if (!img) continue;

    const x = (rect.x - bounds.left) * scale;
    const y = (rect.y - bounds.top) * scale;
    const w = rect.w * scale;
    const h = rect.h * scale;

    try {
      exportCtx.drawImage(img, x, y, w, h);
    } catch (_) {}
  }
}
