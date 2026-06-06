import { createWorkflowSignature } from "../core/workflow_state.mjs";
import { PREVIEW_MAX_PIXELS } from "../export/limits.mjs";

export function buildPreviewState({
  state,
  selectedNodeIds = [],
  workflowJsonText = "",
} = {}) {
  const previewFormat = state?.format === "webp" ? "webp" : "png";
  return {
    ...state,
    format: previewFormat,
    embedWorkflow: false,
    outputResolution: "100%",
    maxLongEdge: 0,
    selectedNodeIds,
    previewFast: true,
    previewMaxPixels: PREVIEW_MAX_PIXELS,
    workflowSignature: createWorkflowSignature(workflowJsonText),
    workflowJsonText,
  };
}

export function getPreviewStateKey(previewState) {
  return JSON.stringify({
    format: previewState.format,
    background: previewState.background,
    solidColor: previewState.solidColor,
    padding: previewState.padding,
    nodeOpacity: previewState.nodeOpacity,
    scopeSelected: previewState.scopeSelected,
    scopeOpacity: previewState.scopeOpacity,
    selectedNodeIds: previewState.selectedNodeIds,
    workflowSignature: previewState.workflowSignature,
  });
}

export function getPreviewMime(previewState) {
  return previewState?.format === "webp" ? "image/webp" : "image/png";
}
