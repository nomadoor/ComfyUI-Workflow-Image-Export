import { app } from "/scripts/app.js";
import { detectBackend } from "../detect.js";
import { captureNode2 } from "../backends/node2_compositor_capture.js";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.js";
import { exportWorkflowPng } from "../../export/index.js";
import { computeGraphBBox } from "../../export/bbox.js";
import { resolveClassicRasterRoute } from "../../export/limits.js";
import { embedWorkflowInPngBlob } from "../../export/png_embed_workflow.js";
import {
  attachCaptureWarnings,
  partitionCaptureNotices,
} from "./warnings.js";
import {
  getSelectedNodeIdsFromApp,
  getWorkflowJsonFromApp,
  toWorkflowJsonString,
} from "../workflow_state.js";

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
    result = await captureNode2(normalized);
  } else {
    const selectedNodeIds = Array.isArray(normalized.selectedNodeIds)
      ? normalized.selectedNodeIds
      : getSelectedNodeIds();
    // Route selection uses the live graph visible to the user. The exporter
    // later remeasures its synchronized serialized clone because that clone is
    // the geometry it actually renders; the two measurements are not
    // interchangeable.
    const bbox = computeGraphBBox(app?.graph, {
      padding: normalized.padding,
      selectedNodeIds,
      useSelectionOnly: Boolean(normalized.scopeSelected),
    });
    const route = resolveClassicRasterRoute({
      width: bbox.width,
      height: bbox.height,
      maxLongEdge: normalized.maxLongEdge,
      exceedMode: normalized.exceedMode,
    });
    const workflowJson = getWorkflowJson();
    if (!workflowJson) {
      throw new Error("Capture failed: workflow JSON unavailable.");
    }
    const blob = await exportWorkflowPng(workflowJson, {
      backgroundMode: normalized.background,
      backgroundColor: normalized.solidColor,
      padding: normalized.padding,
      nodeOpacity: normalized.nodeOpacity,
      scale: route.renderScale,
      pngCompression: normalized.pngCompression,
      includeGrid: true,
      includeDomOverlays: true,
      debug: normalized.debug,
      embedWorkflow: false,
      format: normalized.format,
      previewFast: Boolean(normalized.previewFast),
      scopeSelected: Boolean(normalized.scopeSelected),
      scopeOpacity: normalized.scopeOpacity,
      selectedNodeIds,
      showLinks: normalized.showLinks !== false,
      linkFilter: normalized.showLinks === false ? "none" : "all",
      onProgress: normalized.onProgress,
      exceedMode: normalized.exceedMode,
      forceTile: route.tiled,
      tileBleed: normalized.tileBleed,
    });
    result = {
      type: "raster",
      mime: normalized.format === "webp" ? "image/webp" : "image/png",
      blob,
      cwieWarnings: blob?.cwieWarnings,
    };
  }

  if (!result) {
    throw new Error("Capture failed: backend produced no result.");
  }


  if (normalized.format === "png" || normalized.format === "webp") {
    const notices = result?.cwieWarnings || result?.blob?.cwieWarnings;
    const { diagnostics, warnings } = partitionCaptureNotices(notices);
    if (warnings?.length) {
      console.warn("[workflow-image-export] export warnings", warnings);
    }
    if (normalized.debug && diagnostics.length) {
      console.debug("[workflow-image-export] export diagnostics", diagnostics);
    }
    const forceTile =
      normalized.exceedMode === "tile" ||
      diagnostics.includes("render:tiled-png");
    const scaled = forceTile ? result : await downscaleIfNeeded(result, normalized);
    if (normalized.format === "png" && normalized.embedWorkflow) {
      const workflowJson = getWorkflowJson();
      const workflowText = toWorkflowJsonString(workflowJson);
      if (workflowText) {
        const blob = await embedWorkflowInPngBlob(scaled.blob, workflowText);
        return attachCaptureWarnings(blob || scaled.blob, warnings);
      }
    }
    return attachCaptureWarnings(scaled.blob, warnings);
  }

  const withBg = await applyBackground(result, normalized);
  const notices = result?.cwieWarnings || result?.blob?.cwieWarnings;
  const { diagnostics, warnings } = partitionCaptureNotices(notices);
  if (warnings?.length && withBg && !withBg.cwieWarnings) {
    withBg.cwieWarnings = warnings;
  }
  if (normalized.debug && diagnostics.length) {
    console.debug("[workflow-image-export] export diagnostics", diagnostics);
  }
  const forceTile =
    normalized.exceedMode === "tile" ||
    diagnostics.includes("render:tiled-png");
  const scaled = forceTile ? withBg : await downscaleIfNeeded(withBg, normalized);
  return attachCaptureWarnings(scaled.blob, warnings);
}

export function isNode2UnsupportedError(error) {
  return Boolean(error && error.code === NODE2_UNSUPPORTED_CODE);
}

export function isWebpHugeUnsupportedError(error) {
  return Boolean(error && error.code === WEBP_HUGE_UNSUPPORTED_CODE);
}
