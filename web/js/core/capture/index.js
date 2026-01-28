import { app } from "/scripts/app.js";
import { detectBackend } from "../detect.js";
import { captureLegacy } from "../backends/legacy_capture.js";
import { applyBackground, downscaleIfNeeded } from "../postprocess/raster.js";
import { exportWorkflowPng } from "../../export/index.js";
import { embedWorkflowInPngBlob } from "../../export/png_embed_workflow.js";

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

function resolveOutputScale(options) {
  return options?.outputResolution === "200%" ? 2 : 1;
}

function getWorkflowJson() {
  const graph = app?.graph;
  if (!graph || typeof graph.serialize !== "function") {
    return null;
  }
  return graph.serialize();
}

function getSelectedNodeIds() {
  const selected =
    app?.canvas?.selected_nodes ||
    app?.canvas?.selectedNodes ||
    app?.graph?.selected_nodes ||
    null;
  if (!selected) return [];
  if (selected instanceof Map) {
    return Array.from(selected.keys()).map((id) => Number(id)).filter(Number.isFinite);
  }
  if (Array.isArray(selected)) {
    return selected
      .map((node) => node?.id)
      .filter((id) => Number.isFinite(id));
  }
  if (typeof selected === "object") {
    return Object.keys(selected)
      .map((id) => Number(id))
      .filter(Number.isFinite);
  }
  return [];
}

function toWorkflowJsonString(workflowJson) {
  if (!workflowJson) return null;
  if (typeof workflowJson === "string") {
    return workflowJson;
  }
  try {
    return JSON.stringify(workflowJson);
  } catch (_) {
    return null;
  }
}

export async function capture(options = {}) {
  const normalized = normalizeExportOptions(options);
  const backend = detectBackend();

  let result;
  if (backend === "node2") {
    const error = new Error("Node2.0 is not supported yet.");
    error.code = NODE2_UNSUPPORTED_CODE;
    throw error;
  } else if (normalized.format === "png") {
    const workflowJson = getWorkflowJson();
    if (!workflowJson) {
      throw new Error("Capture failed: workflow JSON unavailable.");
    }
    const scale = resolveOutputScale(normalized);
    const selectedNodeIds = Array.isArray(normalized.selectedNodeIds)
      ? normalized.selectedNodeIds
      : getSelectedNodeIds();
    const blob = await exportWorkflowPng(workflowJson, {
      backgroundMode: normalized.background,
      backgroundColor: normalized.solidColor,
      padding: normalized.padding,
      scale,
      includeGrid: true,
      includeDomOverlays: false,
      debug: normalized.debug,
      embedWorkflow: false,
      scopeSelected: Boolean(normalized.scopeSelected),
      scopeOpacity: normalized.scopeOpacity,
      selectedNodeIds,
    });
    const warnings = blob?.cwieWarnings;
    if (warnings?.length) {
      console.warn("[workflow-image-export] export warnings", warnings);
    }
    result = {
      type: "raster",
      mime: "image/png",
      blob,
      cwieWarnings: warnings,
    };
  } else {
    result = await captureLegacy(normalized);
  }

  if (!result) {
    throw new Error("Capture failed: backend produced no result.");
  }


  if (normalized.format === "png") {
    const warnings = result?.cwieWarnings || result?.blob?.cwieWarnings;
    const forceTile =
      normalized.exceedMode === "tile" ||
      warnings?.includes?.("render:tiled-png");
    const scaled = forceTile ? result : await downscaleIfNeeded(result, normalized);
    if (normalized.embedWorkflow) {
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
