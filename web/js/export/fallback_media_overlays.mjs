import { app } from "/scripts/app.js";
import {
  collectDomMediaElements,
  getCanvasRoot,
  getDomElementGraphRect,
  getNodeIdFromElement,
  isElementInGraphNode,
} from "../core/overlays/dom_utils.mjs";

function drawVideoPlaceholder(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(x, y, w, h);

  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  const cx = x + w / 2;
  const cy = y + h / 2;
  const size = Math.min(w, h) * 0.2;
  ctx.moveTo(cx - size / 2, cy - size / 2);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx - size / 2, cy + size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

const bgImageCache = new Map();
const lastVideoSrcByNodeId = new Map();

function normalizeSelectedNodeIds(selectedNodeIds) {
  if (selectedNodeIds instanceof Set) return selectedNodeIds;
  if (!Array.isArray(selectedNodeIds)) return null;
  const ids = new Set(selectedNodeIds.map((id) => Number(id)).filter(Number.isFinite));
  return ids.size ? ids : null;
}

function shouldRenderResolvedNode(nodeId, selectedNodeIds, mode) {
  if (!mode || mode === "all") return true;
  if (mode === "none") return false;
  const ids = normalizeSelectedNodeIds(selectedNodeIds);
  if (!ids?.size || !Number.isFinite(nodeId)) return false;
  const isSelected = ids.has(Number(nodeId));
  if (mode === "selected") return isSelected;
  if (mode === "unselected") return !isSelected;
  return true;
}

function sanitizeMediaUrl(url) {
  if (!url) return url;
  try {
    const parsed = new URL(url, window.location.origin);
    parsed.searchParams.delete("rand");
    parsed.searchParams.delete("timestamp");
    parsed.searchParams.delete("deadline");
    const forceSize = parsed.searchParams.get("force_size");
    if (forceSize && forceSize.includes("?")) {
      parsed.searchParams.delete("force_size");
    }
    return parsed.toString();
  } catch (_) {
    return url;
  }
}

function extractBackgroundImageUrl(value) {
  if (!value || value === "none") return "";
  const match = value.match(/url\((['"]?)(.*?)\1\)/i);
  return match ? match[2] : "";
}

function loadImageCached(url) {
  if (!url) return Promise.resolve(null);
  if (bgImageCache.has(url)) {
    return bgImageCache.get(url);
  }
  const promise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.crossOrigin = "anonymous";
    img.src = url;
  });
  bgImageCache.set(url, promise);
  return promise;
}

function isVideoNode(node) {
  const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
  return text.includes("video") && !text.includes("vhs");
}

function isImageNode(node) {
  const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
  if (text.includes("image") && !text.includes("video")) return true;
  if (node?.previewMediaType === "image") return true;
  if (node?.image || node?.img || (Array.isArray(node?.imgs) && node.imgs.length)) return true;
  if (node?.preview || node?.previewImage || node?.preview_image) return true;
  if (node?.images && Array.isArray(node.images) && node.images.length) return true;
  return false;
}

function looksLikeVideoUrl(value) {
  if (typeof value !== "string") return false;
  return /\.(mp4|webm|mov|mkv|avi|gif)$/i.test(value);
}

function looksLikeImageUrl(value) {
  if (typeof value !== "string") return false;
  return /\.(png|jpg|jpeg|webp|bmp|gif)$/i.test(value);
}

function looksLikeFilename(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (!trimmed.includes(".")) return false;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return false;
  return trimmed.length > 4;
}

function buildApiViewUrl(ref) {
  if (!ref?.filename) return null;
  const url = new URL("/api/view", window.location.origin);
  url.searchParams.set("filename", ref.filename);
  if (ref.subfolder) {
    url.searchParams.set("subfolder", ref.subfolder);
  }
  url.searchParams.set("type", ref.type || "input");
  return url.toString();
}

function buildViewUrl(ref) {
  if (!ref?.filename) return null;
  return buildApiViewUrl(ref);
}

function extractFileRefFromNode(node) {
  if (!node) return null;
  const debug = window.__cwie__?.debug;
  const videoLike = (() => {
    const text = `${node?.title || ""} ${node?.type || ""}`.toLowerCase();
    return text.includes("video") && !text.includes("vhs");
  })();

  const tryObject = (obj, path, depth = 0) => {
    if (!obj || typeof obj !== "object") return null;

    const filename =
      obj.filename ||
      obj.file ||
      obj.name ||
      obj.video ||
      (Array.isArray(obj.filenames) ? obj.filenames[0] : null);

    if (filename && typeof filename === "string") {
      if (debug) console.log(`[CWIE] Found ref in ${path}:`, filename);
      return {
        filename,
        subfolder: obj.subfolder || obj.folder,
        type: obj.type,
      };
    }

    if (depth >= 2) return null;
    for (const [key, value] of Object.entries(obj)) {
      if (!value || typeof value !== "object") continue;
      const nested = tryObject(value, `${path}.${key}`, depth + 1);
      if (nested) return nested;
    }
    return null;
  };

  if (debug) console.log(`[CWIE] Inspecting node ${node.id} (${node.title}) for files...`);

  const props = node.properties && typeof node.properties === "object" ? node.properties : null;
  if (props) {
    const ref = tryObject(props, "properties");
    if (ref) return ref;
    for (const [key, value] of Object.entries(props)) {
      const nested = tryObject(value, `properties.${key}`);
      if (nested) return nested;
      if (looksLikeVideoUrl(value)) {
        if (debug) console.log(`[CWIE] Found value ref in properties.${key}:`, value);
        return { filename: value, subfolder: props.subfolder, type: props.type };
      }
    }
  }

  const widgetsValues = node.widgets_values;
  if (Array.isArray(widgetsValues)) {
    for (let i = 0; i < widgetsValues.length; i++) {
      const value = widgetsValues[i];
      if (!value) continue;

      if (typeof value === "string" && (looksLikeVideoUrl(value) || looksLikeFilename(value))) {
        if (debug) console.log(`[CWIE] Found string ref in widgets_values[${i}]:`, value);
        return { filename: value, subfolder: props?.subfolder, type: props?.type };
      }

      if (typeof value === "object") {
        const nested = tryObject(value, `widgets_values[${i}]`);
        if (nested) return nested;

        for (const [key, sub] of Object.entries(value)) {
          if (typeof sub === "string" && (looksLikeVideoUrl(sub) || looksLikeFilename(sub))) {
            if (debug) console.log(`[CWIE] Found deep ref in widgets_values[${i}].${key}:`, sub);
            return { filename: sub, subfolder: props?.subfolder, type: props?.type };
          }
          const deep = tryObject(sub, `widgets_values[${i}].${key}`);
          if (deep) return deep;
        }
      }
    }
  } else if (widgetsValues && typeof widgetsValues === "object") {
    for (const [key, value] of Object.entries(widgetsValues)) {
      const nested = tryObject(value, `widgets_values.${key}`);
      if (nested) return nested;
      if (
        typeof value === "string" &&
        (looksLikeVideoUrl(value) ||
          (videoLike && /video|file|name|preview/i.test(key) && looksLikeFilename(value)))
      ) {
        if (debug) console.log(`[CWIE] Found dict ref in widgets_values.${key}:`, value);
        return { filename: value, subfolder: props?.subfolder, type: props?.type };
      }
    }
  }
  if (debug) console.log(`[CWIE] No file ref found for node ${node.id}`);
  return null;
}

function findLiveNodeById(id) {
  const nodes = app?.graph?._nodes || app?.graph?.nodes || [];
  return nodes.find((node) => node && Number.isFinite(node.id) && node.id === id) || null;
}

function buildDomMediaByNodeId(uiCanvas) {
  const media = collectDomMediaElements(uiCanvas);
  const byId = new Map();
  for (const el of media) {
    const nodeId = getNodeIdFromElement(el);
    if (!Number.isFinite(nodeId)) continue;
    const prev = byId.get(nodeId);
    if (!prev) {
      byId.set(nodeId, el);
      continue;
    }
    const prevIsVideo = prev instanceof HTMLVideoElement;
    const nextIsVideo = el instanceof HTMLVideoElement;
    if (prevIsVideo && !nextIsVideo) {
      byId.set(nodeId, el);
      continue;
    }
    if (!prevIsVideo && nextIsVideo) {
      continue;
    }
    if (prevIsVideo && nextIsVideo) {
      const prevReady = prev.readyState || 0;
      const nextReady = el.readyState || 0;
      if (nextReady > prevReady) {
        byId.set(nodeId, el);
      }
    }
  }
  return byId;
}

function buildDomMediaByOverlap(nodeRects, uiCanvas) {
  const media = collectDomMediaElements(uiCanvas);
  const byId = new Map();
  if (!nodeRects?.length || !media.length) return byId;
  for (const el of media) {
    const rect = getDomElementGraphRect(el, uiCanvas);
    if (!rect) continue;
    let best = null;
    let bestArea = 0;
    for (const nodeRect of nodeRects) {
      if (!Number.isFinite(nodeRect?.id)) continue;
      const left = Math.max(rect.left, nodeRect.left);
      const right = Math.min(rect.right, nodeRect.right);
      const top = Math.max(rect.top, nodeRect.top);
      const bottom = Math.min(rect.bottom, nodeRect.bottom);
      const w = Math.max(0, right - left);
      const h = Math.max(0, bottom - top);
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        best = nodeRect.id;
      }
    }
    if (best !== null && bestArea > 0) {
      const prev = byId.get(best);
      if (!prev) {
        byId.set(best, el);
      } else {
        const prevIsVideo = prev instanceof HTMLVideoElement;
        const nextIsVideo = el instanceof HTMLVideoElement;
        if (prevIsVideo && !nextIsVideo) {
          byId.set(best, el);
        } else if (prevIsVideo && nextIsVideo) {
          const prevReady = prev.readyState || 0;
          const nextReady = el.readyState || 0;
          if (nextReady > prevReady) {
            byId.set(best, el);
          }
        }
      }
    }
  }
  return byId;
}

function selectDomMedia(nodeId, domMediaById, domMediaByOverlap) {
  if (!Number.isFinite(nodeId)) return null;
  return domMediaById.get(nodeId) || domMediaByOverlap.get(nodeId) || null;
}

async function captureFromDomMedia(domMedia) {
  if (!domMedia) return null;
  if (domMedia instanceof HTMLCanvasElement || domMedia instanceof HTMLImageElement) {
    return domMedia;
  }
  if (domMedia instanceof HTMLVideoElement) {
    const captured = captureVideoFrame(domMedia);
    if (captured) return captured;
    if (domMedia.poster) {
      return loadImageCached(domMedia.poster);
    }
  }
  return null;
}

function resolveVideoDrawable(node) {
  const pickBestVideo = (videos) => {
    if (!videos?.length) return null;
    const sorted = [...videos].sort((a, b) => (b?.readyState || 0) - (a?.readyState || 0));
    return sorted[0] || null;
  };
  const fromImageLike = (value) => {
    if (!value) return null;
    if (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement) {
      return value;
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      return value;
    }
    return null;
  };
  const fromArray = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    for (const item of arr) {
      const found = fromImageLike(item);
      if (found) return found;
      if (item && typeof item === "object") {
        const inner = fromImageLike(
          item.canvas || item.image || item.img || item.bitmap || item.preview
        );
        if (inner) return inner;
      }
    }
    return null;
  };
  const fromWidget = (widget) => {
    if (!widget) return null;
    const candidates = [
      widget.videoEl,
      widget.video,
      widget.element,
      widget.el,
      widget.inputEl,
      widget.domEl,
      widget.canvas,
      widget.previewCanvas,
      widget.image,
      widget.img,
    ];
    for (const candidate of candidates) {
      if (
        candidate instanceof HTMLVideoElement ||
        candidate instanceof HTMLCanvasElement ||
        candidate instanceof HTMLImageElement
      ) {
        return candidate;
      }
      if (candidate instanceof HTMLElement) {
        const media = candidate.querySelector?.("canvas,img") || null;
        if (media instanceof HTMLCanvasElement || media instanceof HTMLImageElement) {
          return media;
        }
        const videos = Array.from(candidate.querySelectorAll?.("video") || []);
        const bestVideo = pickBestVideo(videos);
        if (bestVideo) return bestVideo;
      }
    }
    return null;
  };

  const candidates = [
    node?.video,
    node?.videoEl,
    node?.videoElement,
    node?.videos?.[0],
    node?.canvas,
    node?.previewCanvas,
    node?.image,
    node?.img,
    node?.imgs?.[0],
    node?.preview,
    node?.previewImage,
    node?.preview_image,
    node?.images,
    node?.animatedImages,
  ];
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLVideoElement ||
      candidate instanceof HTMLCanvasElement ||
      candidate instanceof HTMLImageElement
    ) {
      return candidate;
    }
    if (typeof ImageBitmap !== "undefined" && candidate instanceof ImageBitmap) {
      return candidate;
    }
    const arrayPick = fromArray(candidate);
    if (arrayPick) {
      return arrayPick;
    }
  }
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  for (const widget of widgets) {
    const media = fromWidget(widget);
    if (media) return media;
  }
  return null;
}

function captureVideoFrame(video) {
  if (!(video instanceof HTMLVideoElement)) return null;
  if ((video.readyState || 0) < 2) return null;
  const w = Math.max(1, video.videoWidth || 0);
  const h = Math.max(1, video.videoHeight || 0);
  if (w <= 1 || h <= 1) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas;
  } catch (_) {
    return null;
  }
}

function resolveImageDrawable(node) {
  const fromImageLike = (value) => {
    if (!value) return null;
    if (value instanceof HTMLCanvasElement || value instanceof HTMLImageElement) {
      return value;
    }
    if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
      return value;
    }
    return null;
  };
  const fromArray = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return null;
    for (const item of arr) {
      const found = fromImageLike(item);
      if (found) return found;
      if (item && typeof item === "object") {
        const inner = fromImageLike(
          item.canvas || item.image || item.img || item.bitmap || item.preview
        );
        if (inner) return inner;
        if (item.url && typeof item.url === "string") {
          return item.url;
        }
      }
    }
    return null;
  };

  const candidates = [
    node?.canvas,
    node?.previewCanvas,
    node?.image,
    node?.img,
    node?.imgs?.[0],
    node?.preview,
    node?.previewImage,
    node?.preview_image,
    node?.images,
    node?.animatedImages,
    node?.frames,
  ];
  for (const candidate of candidates) {
    if (
      candidate instanceof HTMLCanvasElement ||
      candidate instanceof HTMLImageElement
    ) {
      return candidate;
    }
    if (typeof ImageBitmap !== "undefined" && candidate instanceof ImageBitmap) {
      return candidate;
    }
    const arrayPick = fromArray(candidate);
    if (arrayPick) {
      return arrayPick;
    }
    if (typeof candidate === "string" && looksLikeImageUrl(candidate)) {
      return candidate;
    }
  }
  return null;
}

function computePreviewRect({ rect, node, bounds, scale }) {
  const liveNode = findLiveNodeById(node.id);
  const baseNode = liveNode || node;
  const nodePos = baseNode?.pos || baseNode?._pos || [rect.left, rect.top];

  const deltaX = nodePos[0] - rect.left;
  const deltaY = nodePos[1] - rect.top;

  const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const padX = 1;
  const padY = 2;

  const widgetStartY = Number.isFinite(baseNode?.widgets_start_y)
    ? baseNode.widgets_start_y
    : Number.isFinite(node?.widgets_start_y)
      ? node.widgets_start_y
      : titleHeight;

  const nodeWidgetHeight = window?.LiteGraph?.NODE_WIDGET_HEIGHT || 20;
  const widgets = Array.isArray(baseNode?.widgets) ? baseNode.widgets : [];

  let maxWidgetBottom = widgetStartY;
  if (widgets.length) {
    for (const widget of widgets) {
      if (!widget) continue;
      const wy = Number.isFinite(widget.y) ? widget.y : maxWidgetBottom;
      const wh = Number.isFinite(widget.height) && widget.height > 0 ? widget.height : nodeWidgetHeight;
      maxWidgetBottom = Math.max(maxWidgetBottom, wy + wh + 4);
    }
  } else {
    maxWidgetBottom = Math.max(maxWidgetBottom, titleHeight);
  }

  const previewTop = deltaY + maxWidgetBottom;
  const availableH = (rect.bottom - rect.top) - previewTop - padY;
  const availableW = (rect.right - rect.left) - padX * 2;

  if (availableW <= 4 || availableH <= 4) {
    return null;
  }

  const x = (rect.left + padX - bounds.left) * scale;
  const y = (rect.top + previewTop - bounds.top) * scale;
  const w = availableW * scale;
  const h = availableH * scale;

  return {
    x,
    y,
    w,
    h,
    debug: {
      rect,
      nodePos,
      livePos: liveNode?.pos || liveNode?._pos,
      liveSize: liveNode?.size || liveNode?._size,
      widgetStartY,
      widgetBottom: maxWidgetBottom,
      previewTop,
      titleHeight,
      padX,
      padY,
      bounds,
      deltaX,
      deltaY,
    },
  };
}

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
