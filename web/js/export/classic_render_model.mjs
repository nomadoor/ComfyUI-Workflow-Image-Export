import { buildWidgetRenderPlan } from "../core/backends/widget_render_plan.mjs?v=20260920-2";
import { snapshotPlannedWidgetMedia } from "./widget_media_fallback.mjs?v=20260920-2";

function freezeRecord(value) {
  return value && typeof value === "object"
    ? Object.freeze({ ...value })
    : value;
}

function freezePlanEntry(entry) {
  return Object.freeze({
    ...entry,
    graphRect: freezeRecord(entry?.graphRect),
    nodeGraphRect: freezeRecord(entry?.nodeGraphRect),
    relativeGraphRect: freezeRecord(entry?.relativeGraphRect),
    style: freezeRecord(entry?.style),
  });
}

export async function captureClassicRenderModel({
  graph,
  uiCanvas = null,
  mediaSnapshotCache = new Map(),
  debugLog = null,
} = {}) {
  const nodes = graph?._nodes || graph?.nodes || [];
  const widgetInventory = Object.freeze(nodes
    .filter((node) => node?.id !== undefined && node?.id !== null)
    .map((node) => Object.freeze({
      nodeId: node.id,
      widgets: Object.freeze((Array.isArray(node.widgets) ? node.widgets : []).map((widget) =>
        Object.freeze({
          name: String(widget?.name || widget?.options?.name || ""),
          type: String(widget?.type || ""),
        })
      )),
    })));
  const widgetPlan = Object.freeze(buildWidgetRenderPlan({
    graph,
    uiCanvas,
    allowDom: true,
  }).map(freezePlanEntry));

  await snapshotPlannedWidgetMedia({
    plan: widgetPlan,
    mediaSnapshotCache,
  });
  debugLog?.("render-model.capture", {
    widgets: widgetPlan.length,
    media: widgetPlan.filter((entry) => entry.source === "media").length,
  });

  return Object.freeze({
    widgetPlan,
    widgetInventory,
    mediaSnapshotCache,
  });
}
