export function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const lines = [];
  const rawLines = text.split("\n");

  const pushWrappedWord = (word, currentLine) => {
    let line = currentLine;
    for (const ch of word) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    return line;
  };

  for (const raw of rawLines) {
    if (!raw) {
      lines.push("");
      continue;
    }

    const words = raw.split(" ");
    let line = "";
    for (const word of words) {
      if (!word) {
        const spaced = line + " ";
        if (ctx.measureText(spaced).width > maxWidth && line) {
          lines.push(line);
          line = "";
        } else {
          line = spaced;
        }
        continue;
      }

      const withSpace = line ? `${line} ${word}` : word;
      if (ctx.measureText(withSpace).width <= maxWidth) {
        line = withSpace;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
      }

      if (ctx.measureText(word).width <= maxWidth) {
        line = word;
      } else {
        line = pushWrappedWord(word, line);
      }
    }
    lines.push(line);
  }

  let offsetY = y;
  for (const line of lines) {
    if (offsetY > y + lineHeight * (maxLines - 1) + 0.5) {
      break;
    }
    ctx.fillText(line, x, offsetY);
    offsetY += lineHeight;
  }
}

export function getEffectiveBackground(el) {
  let node = el;
  while (node && node !== document.body) {
    const bg = window.getComputedStyle(node).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
    node = node.parentElement;
  }
  return null;
}

export function resolveOpaqueBackground(...elements) {
  for (const el of elements) {
    const bg = el ? getEffectiveBackground(el) : null;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
      return bg;
    }
  }
  const rootStyle = window.getComputedStyle(document.documentElement);
  const vars = [
    "--comfy-input-bg",
    "--comfy-menu-bg",
    "--p-surface-800",
    "--p-content-background",
  ];
  for (const name of vars) {
    const value = rootStyle.getPropertyValue(name)?.trim();
    if (value && value !== "transparent") {
      return value;
    }
  }
  return "rgb(32, 32, 36)";
}

export function isEffectivelyVisibleElement(el) {
  if (!(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  if (!style) return true;
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") return false;
  const opacity = Number.parseFloat(style.opacity || "1");
  if (Number.isFinite(opacity) && opacity <= 0.01) return false;
  return true;
}

function cloneWithInlineStyles(src, options = {}, depth = 0) {
  const MAX_DEPTH = 100;
  if (depth > MAX_DEPTH) return src.cloneNode(false);
  if (src.nodeType !== 1) return src.cloneNode(true);
  const dst = src.cloneNode(false);
  try {
    const computed = window.getComputedStyle(src);
    let style = "";
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      try {
        if (options.stripLayoutProps && (
          prop === "position" ||
          prop === "left" ||
          prop === "top" ||
          prop === "right" ||
          prop === "bottom" ||
          prop === "inset" ||
          prop === "inset-block" ||
          prop === "inset-block-end" ||
          prop === "inset-block-start" ||
          prop === "inset-inline" ||
          prop === "inset-inline-end" ||
          prop === "inset-inline-start" ||
          prop === "transform"
        )) {
          continue;
        }
        const val = computed.getPropertyValue(prop);
        if (val) style += `${prop}:${val};`;
      } catch (_) {}
    }
    dst.style.cssText = style;
  } catch (_) {}

  for (const child of src.childNodes) {
    dst.appendChild(cloneWithInlineStyles(child, options, depth + 1));
  }
  return dst;
}

export function isCanvasBlank(canvas) {
  const ctx = canvas?.getContext?.("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return true;
  const { width, height } = canvas;
  const samplePoints = [
    [0, 0],
    [Math.max(0, Math.floor(width / 2)), Math.max(0, Math.floor(height / 2))],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
    [Math.max(0, Math.floor(width / 4)), Math.max(0, Math.floor(height / 4))],
    [Math.max(0, Math.floor((width * 3) / 4)), Math.max(0, Math.floor((height * 3) / 4))],
  ];
  for (const [x, y] of samplePoints) {
    try {
      const data = ctx.getImageData(x, y, 1, 1).data;
      if ((data?.[3] || 0) > 0) return false;
    } catch (_) {
      return false;
    }
  }
  return true;
}

export async function captureElementAsCanvas(el, width, height, options = {}) {
  const w = Math.ceil(Math.max(1, width));
  const h = Math.ceil(Math.max(1, height));

  let clone = null;
  try {
    clone = cloneWithInlineStyles(el, options);
  } catch (error) {
    return { canvas: null, stage: "clone", error: error?.message || String(error) };
  }

  for (const img of clone.querySelectorAll("img")) {
    const src = img.getAttribute("src") || "";
    if (src.startsWith("http") || src.startsWith("//")) img.removeAttribute("src");
  }

  const svgStr = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`,
    `<foreignObject width="${w}" height="${h}" x="0" y="0">`,
    `<div xmlns="http://www.w3.org/1999/xhtml" `,
    `style="width:${w}px;height:${h}px;overflow:hidden;margin:0;padding:0;box-sizing:border-box;">`,
    clone.outerHTML,
    `</div>`,
    `</foreignObject>`,
    `</svg>`,
  ].join("");

  return new Promise((resolve) => {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve({ canvas: null, stage: "context", error: "2d context unavailable" });
        return;
      }
      try {
        ctx.drawImage(img, 0, 0);
        resolve({ canvas, stage: "draw", error: null });
      } catch (error) {
        resolve({ canvas: null, stage: "draw", error: error?.message || String(error) });
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ canvas: null, stage: "image-load", error: "svg foreignObject image failed to load" });
    };
    img.src = url;
  });
}

export function parsePx(value, fallback = 0) {
  if (!value) return fallback;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

export function drawTextBlockToRect(exportCtx, text, rect, style = {}) {
  if (!text || !text.trim()) return false;
  const x = rect.x;
  const y = rect.y;
  const w = rect.w;
  const h = rect.h;
  const fontSize = Number.isFinite(style.fontSize) ? style.fontSize : 12;
  const lineHeight = Number.isFinite(style.lineHeight) ? style.lineHeight : fontSize * 1.35;
  const paddingLeft = Number.isFinite(style.paddingLeft) ? style.paddingLeft : 0;
  const paddingTop = Number.isFinite(style.paddingTop) ? style.paddingTop : 0;
  const paddingRight = Number.isFinite(style.paddingRight) ? style.paddingRight : 0;
  const paddingBottom = Number.isFinite(style.paddingBottom) ? style.paddingBottom : 0;

  exportCtx.save();
  exportCtx.textBaseline = "top";
  exportCtx.font = style.font || `${fontSize}px sans-serif`;
  if (style.background && style.background !== "rgba(0, 0, 0, 0)" && style.background !== "transparent") {
    exportCtx.fillStyle = style.background;
    exportCtx.fillRect(x, y, w, h);
  }
  exportCtx.beginPath();
  exportCtx.rect(x, y, w, h);
  exportCtx.clip();
  exportCtx.fillStyle = style.color || "#ffffff";
  const innerX = x + paddingLeft;
  const innerY = y + paddingTop;
  const innerW = Math.max(1, w - paddingLeft - paddingRight);
  const innerH = Math.max(1, h - paddingTop - paddingBottom);
  const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
  wrapText(exportCtx, text, innerX, innerY, innerW, lineHeight, maxLines);
  exportCtx.restore();
  return true;
}

export function formatCanvasFont(style, fallbackSize = 12) {
  const size = parsePx(style.fontSize, fallbackSize);
  return `${style.fontStyle || ""} ${style.fontVariant || ""} ${style.fontWeight || ""} ${size}px ${style.fontFamily || "sans-serif"}`.trim();
}
