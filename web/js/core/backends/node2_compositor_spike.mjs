import { app } from "/scripts/app.js";

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
    html.cwie-node2-capturing .cwie-dialog-backdrop {
      visibility: hidden !important;
    }
  `;
  document.head.appendChild(style);
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

async function waitVideoFrame(video, count = 2, log) {
  for (let i = 0; i < count; i += 1) {
    if (typeof video.requestVideoFrameCallback === "function") {
      await withTimeout(new Promise((resolve) => {
        video.requestVideoFrameCallback(() => resolve());
      }), `video frame ${i + 1}`);
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
    video: true,
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
    await waitVideoFrame(video, 2, log);
    const { canvas, ctx, width, height } = drawVideoToCanvas(video);
    const probe = await canvasProbe(canvas, ctx, width, height);
    report.frame = {
      width,
      height,
      dpr: window.devicePixelRatio || 1,
      ...probe,
    };
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
  const log = options.log || console.log;
  const targetName = options.target || "commonRoot";
  const target = resolveTarget(targetName);
  const report = { startedAt: new Date().toISOString(), targetName, before: inspectNode2Targets() };

  ensureSpikeStyle();
  const captureHandle = await maybeSetCaptureHandle(log);
  document.documentElement.classList.add("cwie-node2-capturing");

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
    document.documentElement.classList.remove("cwie-node2-capturing");
  }
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
  const log = options.log || console.log;
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
