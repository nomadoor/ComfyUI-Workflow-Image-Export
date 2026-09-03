import { app } from "/scripts/app.js";
import { detectBackend } from "../detect.mjs?v=20260825-2";
import { captureLegacy } from "../backends/legacy_capture.mjs?v=20260903-19";
import { captureNode2 } from "../backends/node2_compositor_capture.mjs?v=20260903-16";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.mjs";
import { exportWorkflowPng } from "../../export/index.mjs?v=20260903-20";
import { computeGraphBBox } from "../../export/bbox.mjs?v=20260903-16";
import { resolveRasterExceedPlan } from "../../export/limits.mjs?v=20260825-2";
import { embedWorkflowInPngBlob } from "../../export/png_embed_workflow.mjs";
import {
  attachCaptureWarnings,
  partitionCaptureNotices,
} from "./warnings.mjs?v=20260903-16";
import { resolveOutputResolutionScale } from "../output_scale.mjs?v=20260825-2";
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
  } else if (normalized.format === "png" || normalized.format === "webp") {
    const selectedNodeIds = Array.isArray(normalized.selectedNodeIds)
      ? normalized.selectedNodeIds
      : getSelectedNodeIds();
    const scale = resolveOutputResolutionScale(normalized.outputResolution);
    // Route selection uses the live graph visible to the user. The offscreen
    // exporter later remeasures its synchronized serialized clone because that
    // clone is the geometry it actually renders; the two measurements are not
    // interchangeable.
    const bbox = computeGraphBBox(app?.graph, {
      padding: normalized.padding,
      selectedNodeIds,
      useSelectionOnly: Boolean(normalized.scopeSelected),
    });
    const exceedPlan = resolveRasterExceedPlan({
      width: bbox.width,
      height: bbox.height,
      scale,
      maxLongEdge: normalized.maxLongEdge,
      exceedMode: normalized.exceedMode,
    });
    if (exceedPlan.useTiledExport) {
      const workflowJson = getWorkflowJson();
      if (!workflowJson) {
        throw new Error("Capture failed: workflow JSON unavailable.");
      }
      const blob = await exportWorkflowPng(workflowJson, {
        backgroundMode: normalized.background,
        backgroundColor: normalized.solidColor,
        padding: normalized.padding,
        nodeOpacity: normalized.nodeOpacity,
        scale: exceedPlan.renderScale,
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
        showLinks: normalized.showLinks !== false,
        linkFilter: normalized.showLinks === false ? "none" : "all",
        onProgress: normalized.onProgress,
        exceedMode: normalized.exceedMode,
        forceTile: true,
        tileBleed: normalized.tileBleed,
      });
      const warnings = blob?.cwieWarnings;
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
        showLinks: normalized.showLinks !== false,
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
