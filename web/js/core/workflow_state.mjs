import { normalizeNodeIdList } from "./node_ids.mjs";

export function normalizeSelectedNodeIds(value) {
  return normalizeNodeIdList(value);
}

function getSelectedItemNodeIds(app) {
  const selectedItems = app?.canvas?.selectedItems;
  if (!(selectedItems instanceof Set) || selectedItems.size === 0) return [];

  const graphNodes = app?.graph?._nodes || app?.graph?.nodes || [];
  const nodes = graphNodes instanceof Map
    ? Array.from(graphNodes.values())
    : Array.isArray(graphNodes)
      ? graphNodes
      : Object.values(graphNodes || {});
  const nodeObjects = new Set(nodes.filter(Boolean));
  return normalizeSelectedNodeIds(
    Array.from(selectedItems).filter((item) => nodeObjects.has(item))
  );
}

export function getSelectedNodeIdsFromApp(app) {
  const legacySources = [
    app?.canvas?.selected_nodes,
    app?.canvas?.selectedNodes,
    app?.graph?.selected_nodes,
  ];
  for (const source of legacySources) {
    const ids = normalizeSelectedNodeIds(source);
    if (ids.length > 0) return ids;
  }
  return getSelectedItemNodeIds(app);
}

export function getWorkflowJsonFromApp(app) {
  const graph = app?.graph;
  if (!graph || typeof graph.serialize !== "function") {
    return null;
  }
  try {
    return graph.serialize();
  } catch (_) {
    return null;
  }
}

export function toWorkflowJsonString(workflowJson) {
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

export function getWorkflowJsonTextFromApp(app) {
  return toWorkflowJsonString(getWorkflowJsonFromApp(app));
}

export function hashString(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createWorkflowSignature(workflowJsonText) {
  if (!workflowJsonText) {
    return "unavailable";
  }
  return `${workflowJsonText.length}:${hashString(workflowJsonText)}`;
}
