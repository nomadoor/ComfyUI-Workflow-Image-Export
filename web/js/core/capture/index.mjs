import { app } from "/scripts/app.js";
import { detectBackend } from "../detect.mjs";
import { captureLegacy } from "../backends/legacy_capture.mjs";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.mjs";
import { exportWorkflowPng } from "../../export/index.mjs";
import { embedWorkflowInPngBlob } from "../../export/png_embed_workflow.mjs";
import {
  getSelectedNodeIdsFromApp,
  getWorkflowJsonFromApp,
  toWorkflowJsonString,
} from "../workflow_state.mjs";

export const NODE2_UNSUPPORTED_CODE = "NODE2_UNSUPPORTED";
export const WEBP_HUGE_UNSUPPORTED_CODE = "WEBP_HUGE_UNSUPPORTED";

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

function resolveOutputScale(options) {
  return options?.outputResolution === "200%" ? 2 : 1;
}

function getWorkflowJson() {
  return getWorkflowJsonFromApp(app);
}

function getSelectedNodeIds() {
  return getSelectedNodeIdsFromApp(app);
}

export async function capture(options = {}) {
  const normalized = normalizeExportOptions(options);
  const backend = detectBackend();

  let result;
  if (backend === "node2") {
    const error = new Error("Node2.0 is not supported yet.");
    error.code = NODE2_UNSUPPORTED_CODE;
    throw error;
  } else if (normalized.format === "png" || normalized.format === "webp") {
    const selectedNodeIds = Array.isArray(normalized.selectedNodeIds)
      ? normalized.selectedNodeIds
      : getSelectedNodeIds();
    if (normalized.exceedMode === "tile") {
      const workflowJson = getWorkflowJson();
      if (!workflowJson) {
        throw new Error("Capture failed: workflow JSON unavailable.");
      }
      const scale = resolveOutputScale(normalized);
      const blob = await exportWorkflowPng(workflowJson, {
        backgroundMode: normalized.background,
        backgroundColor: normalized.solidColor,
        padding: normalized.padding,
        nodeOpacity: normalized.nodeOpacity,
        scale,
        pngCompression: normalized.pngCompression,
        includeGrid: true,
        includeDomOverlays: true,
        debug: normalized.debug,
        embedWorkflow: false,
        format: normalized.format,
        previewFast: Boolean(normalized.previewFast),
        maxPixels: normalized.previewMaxPixels,
        scopeSelected: Boolean(normalized.scopeSelected),
        scopeOpacity: normalized.scopeOpacity,
        selectedNodeIds,
        onProgress: normalized.onProgress,
        exceedMode: normalized.exceedMode,
        tileBleed: normalized.tileBleed,
      });
      const warnings = blob?.cwieWarnings;
      if (warnings?.length) {
        console.warn("[workflow-image-export] export warnings", warnings);
      }
      result = {
        type: "raster",
        mime: normalized.format === "webp" ? "image/webp" : "image/png",
        blob,
        cwieWarnings: warnings,
      };
    } else {
      result = await captureLegacy({
        ...normalized,
        background: normalized.background,
        solidColor: normalized.solidColor,
        includeGrid: true,
        scopeSelected: Boolean(normalized.scopeSelected),
        scopeOpacity: normalized.scopeOpacity,
        selectedNodeIds,
        skipWidgetCapture: true,
      });
    }
  } else {
    result = await captureLegacy(normalized);
  }

  if (!result) {
    throw new Error("Capture failed: backend produced no result.");
  }


  if (normalized.format === "png" || normalized.format === "webp") {
    const warnings = result?.cwieWarnings || result?.blob?.cwieWarnings;
    const forceTile =
      normalized.exceedMode === "tile" ||
      warnings?.includes?.("render:tiled-png");
    const scaled = forceTile ? result : await downscaleIfNeeded(result, normalized);
    if (normalized.format === "png" && normalized.embedWorkflow) {
      const workflowJson = getWorkflowJson();
      const workflowText = toWorkflowJsonString(workflowJson);
      if (workflowText) {
        const blob = await embedWorkflowInPngBlob(scaled.blob, workflowText);
        return blob || scaled.blob;
      }
    }
    return scaled.blob;
  }

  const withBg = await applyBackground(result, normalized);
  const warnings = result?.cwieWarnings || result?.blob?.cwieWarnings;
  if (warnings?.length && withBg && !withBg.cwieWarnings) {
    withBg.cwieWarnings = warnings;
  }
  const forceTile =
    normalized.exceedMode === "tile" ||
    warnings?.includes?.("render:tiled-png");
  const scaled = forceTile ? withBg : await downscaleIfNeeded(withBg, normalized);
  return scaled.blob;
}

export function isNode2UnsupportedError(error) {
  return Boolean(error && error.code === NODE2_UNSUPPORTED_CODE);
}

export function isWebpHugeUnsupportedError(error) {
  return Boolean(error && error.code === WEBP_HUGE_UNSUPPORTED_CODE);
}
