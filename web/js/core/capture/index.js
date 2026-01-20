import { detectBackend } from "../detect.js";
import { captureLegacy } from "../backends/legacy_capture.js";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.js";

export const NODE2_UNSUPPORTED_CODE = "NODE2_UNSUPPORTED";

export function detectBackendType() {
  return detectBackend();
}

export async function getPreviewInfo(options = {}) {
  const { maxLongEdge = 0, outputResolution = "auto" } = options;
  return {
    estimatedSize: null,
    willDownscale: maxLongEdge > 0 && outputResolution !== "200%",
  };
}

export async function capture(options = {}) {
  const backend = detectBackend();

  let result;
  if (backend === "node2") {
    const error = new Error("Node2.0にはまだ対応していません。");
    error.code = NODE2_UNSUPPORTED_CODE;
    throw error;
  } else {
    result = await captureLegacy(options);
  }

  if (!result) {
    throw new Error("Capture failed: backend produced no result.");
  }

  if (result.type === "svg") {
    return result.blob;
  }

  const withBg = await applyBackground(result, options);
  const scaled = await downscaleIfNeeded(withBg, options);
  return scaled.blob;
}

export function isNode2UnsupportedError(error) {
  return Boolean(error && error.code === NODE2_UNSUPPORTED_CODE);
}
