function toPositiveSize(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(1, Math.ceil(number));
}

function getCanvasContext(canvas) {
  try {
    return canvas?.getContext?.("2d", { alpha: true }) || null;
  } catch (_) {
    return null;
  }
}

export function isCanvasOriginClean(canvas) {
  const ctx = getCanvasContext(canvas);
  if (!ctx) return false;
  try {
    ctx.getImageData(0, 0, 1, 1);
    return true;
  } catch (_) {
    return false;
  }
}

export function drawBlockedMediaPlaceholder(ctx, x, y, w, h, label = "media blocked") {
  if (!ctx || w <= 0 || h <= 0) return;
  ctx.save?.();
  ctx.fillStyle = "rgba(20, 20, 20, 0.92)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 1;
  ctx.strokeRect?.(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  if (w >= 44 && h >= 18 && typeof ctx.fillText === "function") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.font = `${Math.max(9, Math.min(12, Math.floor(h / 6)))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + w / 2, y + h / 2, Math.max(10, w - 8));
  }
  ctx.restore?.();
}

export function drawMediaSafely(exportCtx, media, x, y, w, h, options = {}) {
  const width = toPositiveSize(w);
  const height = toPositiveSize(h);
  if (!exportCtx || !media || !width || !height) {
    return { ok: false, reason: "invalid-geometry" };
  }

  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = getCanvasContext(scratch);
  if (!scratchCtx) {
    if (options.drawPlaceholder !== false) {
      drawBlockedMediaPlaceholder(exportCtx, x, y, w, h, options.placeholderLabel);
    }
    return { ok: false, reason: "scratch-context-unavailable" };
  }

  try {
    scratchCtx.drawImage(media, 0, 0, width, height);
  } catch (error) {
    if (options.drawPlaceholder !== false) {
      drawBlockedMediaPlaceholder(exportCtx, x, y, w, h, options.placeholderLabel);
    }
    return {
      ok: false,
      reason: "drawImage-error",
      error,
    };
  }

  if (!isCanvasOriginClean(scratch)) {
    if (options.drawPlaceholder !== false) {
      drawBlockedMediaPlaceholder(exportCtx, x, y, w, h, options.placeholderLabel);
    }
    return { ok: false, reason: "tainted" };
  }

  try {
    exportCtx.drawImage(scratch, x, y, w, h);
    return { ok: true, reason: "drawn" };
  } catch (error) {
    if (options.drawPlaceholder !== false) {
      drawBlockedMediaPlaceholder(exportCtx, x, y, w, h, options.placeholderLabel);
    }
    return {
      ok: false,
      reason: "export-drawImage-error",
      error,
    };
  }
}
