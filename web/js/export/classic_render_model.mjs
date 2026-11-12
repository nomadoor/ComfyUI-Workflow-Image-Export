import { buildWidgetRenderPlan } from "../core/backends/widget_render_plan.mjs?v=20261113-1";
import { snapshotPlannedWidgetMedia } from "./widget_media_fallback.mjs?v=20260920-2";
import { isMediaOriginClean } from "../core/backends/safe_media_draw.mjs?v=20261109-1";
import { toNodeIdKey } from "../core/node_ids.mjs";

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

// Load Image and execution previews live only on the live node. The clone draws
// them natively through its own preview widget, so only loaded images that
// cannot taint the export canvas are handed over. Other nodes keep the
// thumbnail fallback.
function isDrawablePreviewImage(img) {
  return img?.complete === true && img.naturalWidth > 0 && isMediaOriginClean(img);
}

function captureRuntimePreviews(nodes) {
  const previews = new Map();
  for (const node of nodes) {
    const id = toNodeIdKey(node?.id);
    const imgs = node?.imgs;
    if (id === null || !imgs?.length || node.animatedImages) continue;
    if (!imgs.every(isDrawablePreviewImage)) continue;
    previews.set(id, Object.freeze({
      imgs: Object.freeze([...imgs]),
      imageIndex: node.imageIndex,
    }));
  }
  return previews;
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
    runtimePreviews: captureRuntimePreviews(nodes),
    mediaSnapshotCache,
  });
}
