import { detectBackend } from "../detect.js";
import { captureLegacy } from "../backends/legacy_capture.js";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.js";
import { embedWorkflow } from "../postprocess/embed.js";

export const NODE2_UNSUPPORTED_CODE = "NODE2_UNSUPPORTED";

export function detectBackendType() {
  return detectBackend();
}

function normalizeExportOptions(options = {}) {
  const format = String(options.format || "png").toLowerCase();
  const requestedEmbed = Boolean(options.embedWorkflow);
  let embedWorkflow = requestedEmbed;
  let embedForcedReason = null;

  if (format === "webp") {
    embedWorkflow = false;
    embedForcedReason = "WebP metadata embedding is disabled by design.";
  }

  return {
    ...options,
    format,
    embedWorkflow,
    _embedRequested: requestedEmbed,
    _embedForcedReason: embedForcedReason,
  };
}

export async function getPreviewInfo(options = {}) {
  const { maxLongEdge = 0, outputResolution = "auto" } = options;
  return {
    estimatedSize: null,
    willDownscale: maxLongEdge > 0 && outputResolution !== "200%",
  };
}

export async function capture(options = {}) {
  const normalized = normalizeExportOptions(options);
  const backend = detectBackend();

  let result;
  if (backend === "node2") {
    const error = new Error("Node2.0‚Й‚Н‚Ь‚ѕ‘О‰ћ‚µ‚Д‚ў‚Ь‚№‚сЃB");
    error.code = NODE2_UNSUPPORTED_CODE;
    throw error;
  } else {
    result = await captureLegacy(normalized);
  }

  if (!result) {
    throw new Error("Capture failed: backend produced no result.");
  }

  if (result.type === "svg") {
    const embedded = await embedWorkflow(result, normalized);
    return embedded?.blob || result.blob;
  }

  const withBg = await applyBackground(result, normalized);
  const scaled = await downscaleIfNeeded(withBg, normalized);
  const embedded = await embedWorkflow(scaled, normalized);
  return embedded?.blob || scaled.blob;
}

export function isNode2UnsupportedError(error) {
  return Boolean(error && error.code === NODE2_UNSUPPORTED_CODE);
}
