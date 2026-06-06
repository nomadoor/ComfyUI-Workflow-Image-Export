function parseHexColor(color) {
  if (!color || typeof color !== "string") return null;
  const hex = color.trim().replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return null;
    }
    return { r, g, b };
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) {
      return null;
    }
    return { r, g, b };
  }
  return null;
}

function parseRgbColor(color) {
  if (!color || typeof color !== "string") return null;
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(",").map((v) => v.trim());
  if (parts.length < 3) return null;
  const r = Number.parseFloat(parts[0]);
  const g = Number.parseFloat(parts[1]);
  const b = Number.parseFloat(parts[2]);
  if (![r, g, b].every((v) => Number.isFinite(v))) return null;
  return { r, g, b };
}

function parseColorToRgb(color) {
  return parseHexColor(color) || parseRgbColor(color);
}

export function isCanvasTransparent(canvas) {
  if (!canvas) return false;
  const sampleSize = 16;
  const sample = document.createElement("canvas");
  sample.width = sampleSize;
  sample.height = sampleSize;
  const sampleCtx = sample.getContext("2d", { alpha: true });
  if (!sampleCtx) return false;
  try {
    sampleCtx.clearRect(0, 0, sampleSize, sampleSize);
    sampleCtx.drawImage(canvas, 0, 0, sampleSize, sampleSize);
    const data = sampleCtx.getImageData(0, 0, sampleSize, sampleSize).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return false;
  }
}

export function recoverTransparentCanvas(canvasA, canvasB, colorA, colorB) {
  const rgbA = parseColorToRgb(colorA);
  const rgbB = parseColorToRgb(colorB);
  if (!rgbA || !rgbB) return null;

  const w = canvasA.width;
  const h = canvasA.height;
  if (w !== canvasB.width || h !== canvasB.height) return null;

  const ctxA = canvasA.getContext("2d", { alpha: true });
  const ctxB = canvasB.getContext("2d", { alpha: true });
  if (!ctxA || !ctxB) return null;

  let dataA;
  let dataB;
  try {
    dataA = ctxA.getImageData(0, 0, w, h).data;
    dataB = ctxB.getImageData(0, 0, w, h).data;
  } catch (_) {
    return null;
  }

  const output = new ImageData(w, h);
  const out = output.data;

  const b1 = [rgbA.r, rgbA.g, rgbA.b];
  const b2 = [rgbB.r, rgbB.g, rgbB.b];

  for (let i = 0; i < dataA.length; i += 4) {
    const c1 = [dataA[i], dataA[i + 1], dataA[i + 2]];
    const c2 = [dataB[i], dataB[i + 1], dataB[i + 2]];
    const alphas = [];
    for (let c = 0; c < 3; c += 1) {
      const denom = b1[c] - b2[c];
      if (denom === 0) continue;
      const alpha = 1 - (c1[c] - c2[c]) / denom;
      if (Number.isFinite(alpha)) {
        alphas.push(alpha);
      }
    }
    let alpha = alphas.length
      ? alphas.reduce((sum, v) => sum + v, 0) / alphas.length
      : 1;
    alpha = Math.min(1, Math.max(0, alpha));

    if (alpha <= 0.001) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    const invAlpha = 1 / alpha;
    const r = (c1[0] - (1 - alpha) * b1[0]) * invAlpha;
    const g = (c1[1] - (1 - alpha) * b1[1]) * invAlpha;
    const b = (c1[2] - (1 - alpha) * b1[2]) * invAlpha;
    out[i] = Math.min(255, Math.max(0, Math.round(r)));
    out[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
    out[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
    out[i + 3] = Math.min(255, Math.max(0, Math.round(alpha * 255)));
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return null;
  ctx.putImageData(output, 0, 0);
  return canvas;
}
