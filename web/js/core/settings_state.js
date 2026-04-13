export const DEFAULTS = {
  format: "png",
  embedWorkflow: true,
  background: "ui",
  solidColor: "#1f1f1f",
  nodeOpacity: 100,
  padding: 100,
  outputResolution: "auto",
  maxLongEdge: 4096,
  exceedMode: "tile",
  pngCompression: 7,
};

function normalizeFormat(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "png" || v === "webp") {
    return v;
  }
  return DEFAULTS.format;
}

function normalizeBackground(value) {
  const v = String(value ?? "").toLowerCase();
  if (["ui", "transparent", "solid"].includes(v)) {
    return v;
  }
  return DEFAULTS.background;
}

function normalizeResolution(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "auto" || v === "100%" || v === "200%") {
    return v;
  }
  return DEFAULTS.outputResolution;
}

function normalizeExceedMode(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "downscale" || v === "tile") {
    return v;
  }
  return DEFAULTS.exceedMode;
}

function normalizeNumber(value, fallback) {
  const num = Number.parseInt(value, 10);
  if (Number.isFinite(num) && num >= 0) {
    return num;
  }
  return fallback;
}

function normalizePngCompression(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return DEFAULTS.pngCompression;
  return Math.min(9, Math.max(0, num));
}

export function normalizeState(raw) {
  const hasEmbedWorkflow = Object.prototype.hasOwnProperty.call(raw ?? {}, "embedWorkflow");
  return {
    format: normalizeFormat(raw?.format),
    embedWorkflow: hasEmbedWorkflow ? Boolean(raw.embedWorkflow) : DEFAULTS.embedWorkflow,
    background: normalizeBackground(raw?.background),
    solidColor: typeof raw?.solidColor === "string" ? raw.solidColor : DEFAULTS.solidColor,
    nodeOpacity: normalizeNumber(raw?.nodeOpacity, DEFAULTS.nodeOpacity),
    padding: normalizeNumber(raw?.padding, DEFAULTS.padding),
    outputResolution: normalizeResolution(raw?.outputResolution),
    maxLongEdge: normalizeNumber(raw?.maxLongEdge, DEFAULTS.maxLongEdge),
    exceedMode: normalizeExceedMode(raw?.exceedMode),
    pngCompression: normalizePngCompression(raw?.pngCompression),
  };
}
