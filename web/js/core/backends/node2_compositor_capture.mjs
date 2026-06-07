import { app } from "/scripts/app.js";
import { computeGraphBBox } from "../../export/bbox.mjs";

const SPIKE_STYLE_ID = "cwie-node2-spike-style";

function logStep(log, label, payload) {
  log?.(`[CWIE][Node2Spike] ${label}`, payload);
}

function asArray(value) {
  return Array.from(value || []);
}

function describeElement(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect?.();
  return {
    tagName: el.tagName,
    id: el.id || "",
    className: typeof el.className === "string" ? el.className : "",
    testId: el.getAttribute?.("data-testid") || "",
    rect: rect
      ? {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
      }
      : null,
  };
}

function getApiSupport() {
  const proto = typeof BrowserCaptureMediaStreamTrack !== "undefined"
    ? BrowserCaptureMediaStreamTrack.prototype
    : null;
  return {
    userAgent: navigator.userAgent,
    isSecureContext: Boolean(window.isSecureContext),
    displayMedia: typeof navigator.mediaDevices?.getDisplayMedia === "function",
    captureHandleConfig: typeof navigator.mediaDevices?.setCaptureHandleConfig === "function",
    restrictionTarget: typeof window.RestrictionTarget?.fromElement === "function",
    restrictTo: typeof proto?.restrictTo === "function",
    cropTarget: typeof window.CropTarget?.fromElement === "function",
    cropTo: typeof proto?.cropTo === "function",
    imageCapture: typeof window.ImageCapture === "function",
    requestVideoFrameCallback: typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function",
  };
}

function getGraphRootFromTransformPane(transformPane) {
  let node = transformPane?.parentElement || null;
  while (node && node !== document.body) {
    if (node.querySelector?.("#graph-canvas") && node.querySelector?.('[data-testid="transform-pane"]')) {
      return node;
    }
    node = node.parentElement;
  }
  return document.querySelector("#graph-canvas")?.parentElement || null;
}

export function inspectNode2Targets() {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const root = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = root ? asArray(root.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const vueNodeCount = transformPane?.querySelectorAll?.("[data-node-id]")?.length || 0;

  const candidates = {
    commonRoot: root,
    transformPane,
    linkOverlayCanvas,
    graphCanvas,
  };

  return {
    api: getApiSupport(),
    appCanvas: describeElement(app?.canvas?.canvas || null),
    candidates: Object.fromEntries(
      Object.entries(candidates).map(([key, value]) => [key, describeElement(value)])
    ),
    counts: {
      rootCanvases: siblingCanvases.length,
      vueNodes: vueNodeCount,
    },
    likelyNode2: Boolean(transformPane && linkOverlayCanvas),
  };
}

function resolveTarget(name = "commonRoot") {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const commonRoot = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = commonRoot ? asArray(commonRoot.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const targets = {
    commonRoot,
    transformPane,
    linkOverlayCanvas,
    graphCanvas,
  };
  return targets[name] || commonRoot || transformPane || graphCanvas;
}

function ensureSpikeStyle() {
  if (document.getElementById(SPIKE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SPIKE_STYLE_ID;
  style.textContent = `
    html.cwie-node2-capturing [data-testid="selection-toolbox"],
    html.cwie-node2-capturing [data-testid="node-searchbox-popover"],
    html.cwie-node2-capturing .p-tooltip,
    html.cwie-node2-capturing .p-contextmenu,
    html.cwie-node2-capturing .litegraph.litecontextmenu,
    html.cwie-node2-capturing .cwie-backdrop,
    html.cwie-node2-capturing .cwie-dialog-backdrop,
    html.cwie-node2-capturing #comfyui-body-top,
    html.cwie-node2-capturing #comfyui-body-left,
    html.cwie-node2-capturing #comfyui-body-right,
    html.cwie-node2-capturing #comfyui-body-bottom,
    html.cwie-node2-capturing [data-testid*="toolbar" i],
    html.cwie-node2-capturing [data-testid*="menu" i],
    html.cwie-node2-capturing [data-testid*="selection" i],
    html.cwie-node2-capturing [class*="toolbar" i],
    html.cwie-node2-capturing [class*="palette" i],
    html.cwie-node2-capturing [class*="actionbar" i],
    html.cwie-node2-capturing [class*="topbar" i] {
      visibility: hidden !important;
      pointer-events: none !important;
    }

    html.cwie-node2-capturing #graph-canvas-container > :not(#graph-canvas):not([data-testid="transform-pane"]):not(canvas:not([id])) {
      visibility: hidden !important;
    }

    html.cwie-node2-capturing #graph-canvas-container,
    html.cwie-node2-capturing #graph-canvas-container * {
      cursor: none !important;
    }
  `;
  document.head.appendChild(style);
}

function getNode2Layers() {
  const graphCanvas = document.querySelector("#graph-canvas") || app?.canvas?.canvas || null;
  const transformPane = document.querySelector('[data-testid="transform-pane"]');
  const root = getGraphRootFromTransformPane(transformPane);
  const siblingCanvases = root ? asArray(root.querySelectorAll("canvas")) : [];
  const linkOverlayCanvas = siblingCanvases.find((canvas) => canvas !== graphCanvas && !canvas.id) || null;
  const vueNodes = transformPane ? asArray(transformPane.querySelectorAll("[data-node-id]")) : [];
  return { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes };
}

function hideNode2CaptureChrome() {
  const { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes } = getNode2Layers();
  if (!root) return () => {};
  const keepTree = [graphCanvas, linkOverlayCanvas].filter(Boolean);
  const changed = [];
  const shouldKeep = (el) => {
    if (!el || el === root || el === transformPane) return true;
    if (keepTree.some((keep) => el === keep || keep.contains(el))) return true;
    return vueNodes.some((node) => el === node || node.contains(el) || el.contains(node));
  };
  for (const el of asArray(root.querySelectorAll("*"))) {
    if (!(el instanceof HTMLElement) || shouldKeep(el)) continue;
    changed.push([el, el.style.visibility, el.style.pointerEvents]);
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
  }
  return () => {
    for (const [el, visibility, pointerEvents] of changed) {
      el.style.visibility = visibility;
      el.style.pointerEvents = pointerEvents;
    }
  };
}

function hideKnownComfyChrome() {
  const selectors = [
    "#comfyui-body-top",
    "#comfyui-body-left",
    "#comfyui-body-right",
    "#comfyui-body-bottom",
    '[data-testid*="toolbar" i]',
    '[data-testid*="menu" i]',
    '[data-testid*="selection" i]',
    '[class*="toolbar" i]',
    '[class*="palette" i]',
    '[class*="actionbar" i]',
    '[class*="topbar" i]',
  ];
  const changed = [];
  for (const el of asArray(document.querySelectorAll(selectors.join(",")))) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("[data-node-id]")) continue;
    changed.push([el, el.style.visibility, el.style.pointerEvents]);
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
  }
  return () => {
    for (const [el, visibility, pointerEvents] of changed) {
      el.style.visibility = visibility;
      el.style.pointerEvents = pointerEvents;
    }
  };
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function hideIntersectingChrome() {
  const { root, graphCanvas, transformPane, linkOverlayCanvas, vueNodes } = getNode2Layers();
  if (!root) return () => {};
  const rootRect = root.getBoundingClientRect();
  const keep = [root, graphCanvas, transformPane, linkOverlayCanvas].filter(Boolean);
  const changed = [];
  for (const el of asArray(document.body.querySelectorAll("*"))) {
    if (!(el instanceof HTMLElement)) continue;
    if (keep.includes(el)) continue;
    if (vueNodes.some((node) => el === node || node.contains(el) || el.contains(node))) continue;
    if (el.closest(".cwie-dialog") || el.closest(".cwie-backdrop")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !rectsIntersect(rect, rootRect)) continue;
    const style = window.getComputedStyle(el);
    const zIndex = Number.parseInt(style.zIndex, 10);
    const positioned = style.position === "fixed" ||
      style.position === "sticky" ||
      style.position === "absolute" ||
      Number.isFinite(zIndex);
    if (!positioned) continue;
    changed.push([el, el.style.visibility, el.style.pointerEvents]);
    el.style.visibility = "hidden";
    el.style.pointerEvents = "none";
  }
  return () => {
    for (const [el, visibility, pointerEvents] of changed) {
      el.style.visibility = visibility;
      el.style.pointerEvents = pointerEvents;
    }
  };
}

function measureNode2DomCropRect(root, paddingPx) {
  if (!root) return null;
  const rootRect = root.getBoundingClientRect();
  const nodeRects = asArray(root.querySelectorAll("[data-node-id]"))
    .map((node) => node.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0 && rectsIntersect(rect, rootRect));
  if (!nodeRects.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of nodeRects) {
    left = Math.min(left, rect.left - rootRect.left);
    top = Math.min(top, rect.top - rootRect.top);
    right = Math.max(right, rect.right - rootRect.left);
    bottom = Math.max(bottom, rect.bottom - rootRect.top);
  }
  const pad = Math.max(8, Math.min(128, Number(paddingPx) || 56));
  return {
    left: Math.max(0, left - pad),
    top: Math.max(0, top - pad),
    right: Math.min(rootRect.width, right + pad),
    bottom: Math.min(rootRect.height, bottom + pad),
  };
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track.stop();
  }
}

function timeoutError(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function withTimeout(promise, label, timeoutMs = 3000) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitVideoMetadata(video, log) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth && video.videoHeight) {
    return;
  }
  logStep(log, "video.metadata.wait", {
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  });
  await withTimeout(new Promise((resolve, reject) => {
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
    video.addEventListener("resize", () => {
      if (video.videoWidth && video.videoHeight) resolve();
    }, { once: true });
    video.addEventListener("error", () => {
      reject(new Error(video.error?.message || "hidden video failed to load capture stream"));
    }, { once: true });
  }), "hidden video metadata");
}

async function waitVideoFrame(video, count = 2, log, timeoutMs = 3000) {
  for (let i = 0; i < count; i += 1) {
    if (typeof video.requestVideoFrameCallback === "function") {
      try {
        await withTimeout(new Promise((resolve) => {
          video.requestVideoFrameCallback(() => resolve());
        }), `video frame ${i + 1}`, timeoutMs);
      } catch (error) {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
          throw error;
        }
        logStep(log, "video.frame.fallback", {
          frame: i + 1,
          message: error?.message || String(error),
          readyState: video.readyState,
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        });
        await withTimeout(new Promise((resolve) => requestAnimationFrame(() => resolve())), `animation frame fallback ${i + 1}`);
      }
    } else {
      await withTimeout(new Promise((resolve) => requestAnimationFrame(() => resolve())), `animation frame ${i + 1}`);
    }
    logStep(log, "video.frame.waited", {
      frame: i + 1,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
    });
  }
}

async function attachHiddenVideo(stream, log) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.cssText = "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;opacity:0;pointer-events:none;";
  video.srcObject = stream;
  document.body.appendChild(video);
  logStep(log, "video.attach", {
    readyState: video.readyState,
    paused: video.paused,
  });
  await waitVideoMetadata(video, log);
  await withTimeout(video.play(), "hidden video play");
  logStep(log, "video.play.ok", {
    readyState: video.readyState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
  });
  return video;
}

function drawVideoToCanvas(video) {
  const width = Math.max(1, video.videoWidth || video.clientWidth || 1);
  const height = Math.max(1, video.videoHeight || video.clientHeight || 1);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(video, 0, 0, width, height);
  return { canvas, ctx, width, height };
}

async function canvasProbe(canvas, ctx, width, height) {
  const sample = ctx.getImageData(
    Math.max(0, Math.floor(width / 2)),
    Math.max(0, Math.floor(height / 2)),
    1,
    1
  ).data;
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return {
    blobOk: Boolean(blob),
    blobType: blob?.type || null,
    blobSize: blob?.size || 0,
    sampleAlpha: sample[3],
    hasAlphaChannelData: sample[3] < 255,
  };
}

async function maybeSetCaptureHandle(log) {
  const handle = `cwie-node2-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (typeof navigator.mediaDevices?.setCaptureHandleConfig !== "function") {
    return { configured: false, handle };
  }
  try {
    navigator.mediaDevices.setCaptureHandleConfig({
      handle,
      permittedOrigins: ["*"],
    });
    return { configured: true, handle };
  } catch (error) {
    logStep(log, "captureHandleConfig.failed", { message: error?.message || String(error) });
    return { configured: false, handle, error: error?.message || String(error) };
  }
}

async function requestDisplayMedia(log) {
  const preferredOptions = {
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    audio: false,
    video: {
      cursor: "never",
    },
  };
  try {
    return await navigator.mediaDevices.getDisplayMedia(preferredOptions);
  } catch (error) {
    if (error?.name !== "TypeError") {
      throw error;
    }
    logStep(log, "displayMedia.preferredOptions.failed", {
      name: error.name,
      message: error.message,
    });
    return navigator.mediaDevices.getDisplayMedia({ audio: false, video: true });
  }
}

async function captureFrameFromStream(stream, target, targetName, captureHandle, options, log) {
  const report = {
    startedAt: new Date().toISOString(),
    targetName,
    before: inspectNode2Targets(),
    captureHandle,
    track: null,
    restriction: null,
    frame: null,
  };

  const [track] = stream.getVideoTracks();
  const settings = track?.getSettings?.() || {};
  const captureHandleInfo = track?.getCaptureHandle?.() || null;
  report.track = {
    label: track?.label || "",
    settings,
    captureHandle: captureHandleInfo,
    isLikelySelfCapture: captureHandleInfo?.handle === captureHandle.handle ||
      settings.displaySurface === "browser",
  };
  logStep(log, "displayMedia.ok", report.track);

  const video = await attachHiddenVideo(stream, log);
  try {
    report.restriction = await applyTargetRestriction(track, target, {
      prefer: options.prefer || "restriction",
      log,
    });
    logStep(log, "target.apply", report.restriction);
    const frameCount = Math.max(1, Number(options.frameCount) || 2);
    const frameTimeoutMs = Math.max(50, Number(options.frameTimeoutMs) || 3000);
    await waitVideoFrame(video, frameCount, log, frameTimeoutMs);
    const { canvas, ctx, width, height } = drawVideoToCanvas(video);
    const probe = options.probe === false
      ? { blobOk: true, blobType: null, blobSize: 0, probed: false }
      : await canvasProbe(canvas, ctx, width, height);
    report.frame = {
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      ...probe,
    };
    if (options.includeCanvas) {
      report.canvas = canvas;
    }
    logStep(log, "frame.ok", report.frame);
    return report;
  } catch (error) {
    report.error = {
      name: error?.name || "",
      message: error?.message || String(error),
    };
    logStep(log, "frame.failed", report.error);
    return report;
  } finally {
    video.remove();
  }
}

async function applyTargetRestriction(track, target, { prefer = "restriction", log } = {}) {
  const result = {
    target: describeElement(target),
    attempted: null,
    ok: false,
    error: null,
  };
  if (!target) {
    result.error = "target not found";
    return result;
  }

  const canRestrict =
    prefer !== "crop" &&
    typeof window.RestrictionTarget?.fromElement === "function" &&
    typeof track.restrictTo === "function";
  if (canRestrict) {
    result.attempted = "restriction";
    try {
      const restrictionTarget = await window.RestrictionTarget.fromElement(target);
      await track.restrictTo(restrictionTarget);
      result.ok = true;
      return result;
    } catch (error) {
      result.error = error?.message || String(error);
      logStep(log, "restrict.failed", result);
    }
  }

  const canCrop =
    typeof window.CropTarget?.fromElement === "function" &&
    typeof track.cropTo === "function";
  if (canCrop) {
    result.attempted = result.attempted ? `${result.attempted}->crop` : "crop";
    try {
      const cropTarget = await window.CropTarget.fromElement(target);
      await track.cropTo(cropTarget);
      result.ok = true;
      return result;
    } catch (error) {
      result.error = error?.message || String(error);
      logStep(log, "crop.failed", result);
    }
  }

  if (!result.attempted) {
    result.error = "RestrictionTarget/restrictTo and CropTarget/cropTo are unavailable";
  }
  return result;
}

export async function runNode2CaptureFrameSpike(options = {}) {
  const log = Object.hasOwn(options, "log") ? options.log : console.log;
  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const report = { startedAt: new Date().toISOString(), targetName, before: inspectNode2Targets() };

  ensureSpikeStyle();
  const captureHandle = await maybeSetCaptureHandle(log);
  document.documentElement.classList.add("cwie-node2-capturing");
  const restoreHiddenChrome = hideNode2CaptureChrome();
  const restoreKnownChrome = hideKnownComfyChrome();
  const restoreIntersectingChrome = hideIntersectingChrome();

  let stream = null;
  try {
    stream = await requestDisplayMedia(log);
    return await captureFrameFromStream(stream, target, targetName, captureHandle, options, log);
  } catch (error) {
    report.error = {
      name: error?.name || "",
      message: error?.message || String(error),
    };
    logStep(log, "failed", report.error);
    return report;
  } finally {
    stopStream(stream);
    restoreHiddenChrome();
    restoreKnownChrome();
    restoreIntersectingChrome();
    document.documentElement.classList.remove("cwie-node2-capturing");
  }
}

async function waitForNode2CameraSettle(ms = 320) {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, ms));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function withFitNode2View(options, fn) {
  if (options.fitView === false) {
    return fn(null);
  }
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  const root = getNode2Layers().root;
  const graph = app?.graph || canvas?.graph;
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset) || !graph || !root) {
    return fn(null);
  }

  const original = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  const rect = root.getBoundingClientRect();
  const paddingPx = Math.max(24, Math.min(96, Number(options.fitPaddingPx) || 64));
  const bbox = computeGraphBBox(graph, {
    padding: 0,
    useBounding: true,
    debug: Boolean(options.debug),
  });
  const availableWidth = Math.max(1, rect.width - paddingPx * 2);
  const availableHeight = Math.max(1, rect.height - paddingPx * 2);
  const scale = Math.max(
    0.05,
    Math.min(1.2, availableWidth / bbox.width, availableHeight / bbox.height)
  );
  const visibleGraphWidth = rect.width / scale;
  const visibleGraphHeight = rect.height / scale;
  ds.scale = scale;
  ds.offset[0] = ((visibleGraphWidth - bbox.width) / 2) - bbox.minX;
  ds.offset[1] = ((visibleGraphHeight - bbox.height) / 2) - bbox.minY;
  canvas.setDirty?.(true, true);
  await waitForNode2CameraSettle();
  const fitInfo = {
    bbox,
    rootRect: {
      width: rect.width,
      height: rect.height,
    },
    cropRectCss: measureNode2DomCropRect(root, options.cropPaddingPx),
    scale,
    offset: [ds.offset[0], ds.offset[1]],
    cropPaddingPx: Math.max(8, Math.min(128, Number(options.cropPaddingPx) || 56)),
  };
  try {
    return await fn(fitInfo);
  } finally {
    ds.scale = original.scale;
    ds.offset[0] = original.offset[0];
    ds.offset[1] = original.offset[1];
    canvas.setDirty?.(true, true);
    await waitForNode2CameraSettle(120);
  }
}

function cropNode2CanvasToFit(canvas, fitInfo) {
  if (!canvas || !fitInfo?.bbox || !fitInfo?.rootRect) return canvas;
  const { bbox, scale, offset, rootRect, cropPaddingPx, cropRectCss } = fitInfo;
  const ratioX = canvas.width / Math.max(1, rootRect.width);
  const ratioY = canvas.height / Math.max(1, rootRect.height);
  const leftCss = cropRectCss?.left ?? ((bbox.minX + offset[0]) * scale - cropPaddingPx);
  const topCss = cropRectCss?.top ?? ((bbox.minY + offset[1]) * scale - cropPaddingPx);
  const rightCss = cropRectCss?.right ?? ((bbox.maxX + offset[0]) * scale + cropPaddingPx);
  const bottomCss = cropRectCss?.bottom ?? ((bbox.maxY + offset[1]) * scale + cropPaddingPx);
  const sx = Math.max(0, Math.floor(leftCss * ratioX));
  const sy = Math.max(0, Math.floor(topCss * ratioY));
  const ex = Math.min(canvas.width, Math.ceil(rightCss * ratioX));
  const ey = Math.min(canvas.height, Math.ceil(bottomCss * ratioY));
  const width = Math.max(1, ex - sx);
  const height = Math.max(1, ey - sy);
  if (width >= canvas.width && height >= canvas.height) {
    return canvas;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { alpha: true });
  if (!ctx) return canvas;
  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, width, height);
  return out;
}

function toBlob(canvas, mime) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Node 2.0 capture failed: canvas encoding returned no blob."));
        return;
      }
      resolve(blob);
    }, mime);
  });
}

function collectNode2Warnings(options = {}) {
  const warnings = [];
  if (options.background === "transparent") {
    warnings.push("node2:transparent_background_unsupported");
  }
  if (options.background === "solid") {
    warnings.push("node2:solid_background_best_effort");
  }
  if (Number(options.padding) > 0) {
    warnings.push("node2:padding_unsupported");
  }
  if (Boolean(options.scopeSelected)) {
    warnings.push("node2:selection_crop_unsupported");
  }
  if (Number(options.nodeOpacity) < 100) {
    warnings.push("node2:node_opacity_unsupported");
  }
  if (options.exceedMode === "tile") {
    warnings.push("node2:tiled_export_unsupported");
  }
  return warnings;
}

export async function captureNode2(options = {}) {
  const format = String(options.format || "png").toLowerCase();
  const mime = format === "webp" ? "image/webp" : "image/png";
  const report = await withFitNode2View(options, async (fitInfo) => {
    const captured = await runNode2CaptureFrameSpike({
      ...options,
      target: options.target || "commonRoot",
      includeCanvas: true,
      frameCount: 1,
      frameTimeoutMs: 250,
      probe: false,
      log: options.debug ? console.log : null,
    });
    if (captured.canvas && fitInfo) {
      captured.canvas = cropNode2CanvasToFit(captured.canvas, fitInfo);
      captured.frame = {
        ...captured.frame,
        croppedWidth: captured.canvas.width,
        croppedHeight: captured.canvas.height,
      };
      captured.fit = fitInfo;
    }
    return captured;
  });
  if (report.error) {
    throw new Error(`Node 2.0 capture failed: ${report.error.message || "unknown error"}`);
  }
  if (!report.canvas || !report.frame?.blobOk) {
    throw new Error("Node 2.0 capture failed: no captured frame was produced.");
  }
  const blob = await toBlob(report.canvas, mime);
  const warnings = collectNode2Warnings(options);
  if (report.restriction?.attempted && !report.restriction.ok) {
    warnings.push(`node2:target_restriction_failed:${report.restriction.attempted}`);
  }
  return {
    type: "raster",
    mime,
    blob,
    width: report.canvas.width,
    height: report.canvas.height,
    cwieWarnings: warnings,
    node2Report: report,
  };
}

async function waitAfterCameraMove() {
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 280));
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function setCanvasView(ds, offset, scale) {
  ds.offset[0] = offset[0];
  ds.offset[1] = offset[1];
  ds.scale = scale;
  app?.canvas?.setDirty?.(true, true);
}

export async function runNode2TileProbe(options = {}) {
  const log = Object.hasOwn(options, "log") ? options.log : console.log;
  const canvas = app?.canvas;
  const ds = canvas?.ds;
  if (!canvas?.canvas || !ds || !Array.isArray(ds.offset)) {
    return { ok: false, error: "app.canvas.ds unavailable" };
  }
  const original = {
    offset: [ds.offset[0], ds.offset[1]],
    scale: ds.scale || 1,
  };
  const tileCount = Math.max(1, Math.min(3, Number(options.tiles) || 2));
  const viewport = canvas.canvas.getBoundingClientRect();
  const stepX = viewport.width / original.scale;
  const stepY = viewport.height / original.scale;
  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const captures = [];
  ensureSpikeStyle();
  const captureHandle = await maybeSetCaptureHandle(log);
  document.documentElement.classList.add("cwie-node2-capturing");
  let stream = null;
  try {
    stream = await requestDisplayMedia(log);
    for (let y = 0; y < tileCount; y += 1) {
      for (let x = 0; x < tileCount; x += 1) {
        setCanvasView(ds, [
          original.offset[0] - x * stepX,
          original.offset[1] - y * stepY,
        ], original.scale);
        await waitAfterCameraMove();
        const frame = await captureFrameFromStream(
          stream,
          target,
          targetName,
          captureHandle,
          options,
          log
        );
        captures.push({ x, y, frame });
      }
    }
    return { ok: true, original, viewport: describeElement(canvas.canvas), captures };
  } catch (error) {
    return {
      ok: false,
      original,
      viewport: describeElement(canvas.canvas),
      captures,
      error: {
        name: error?.name || "",
        message: error?.message || String(error),
      },
    };
  } finally {
    stopStream(stream);
    document.documentElement.classList.remove("cwie-node2-capturing");
    setCanvasView(ds, original.offset, original.scale);
    await waitAfterCameraMove();
  }
}

export function installNode2SpikeApi(root = window.__cwie__ || {}) {
  root.node2Spike = {
    inspect: inspectNode2Targets,
    captureFrame: runNode2CaptureFrameSpike,
    tileProbe: runNode2TileProbe,
  };
  return root.node2Spike;
}
