export function normalizeSelectedNodeIds(value) {
  if (!value) return [];
  if (value instanceof Map) {
    return Array.from(value.keys()).map((id) => Number(id)).filter(Number.isFinite);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry && typeof entry === "object" && "id" in entry) {
          return Number(entry.id);
        }
        return Number(entry);
      })
      .filter(Number.isFinite);
  }
  if (typeof value === "object") {
    return Object.keys(value).map((id) => Number(id)).filter(Number.isFinite);
  }
  return [];
}

export function getSelectedNodeIdsFromApp(app) {
  return normalizeSelectedNodeIds(
    app?.canvas?.selected_nodes ||
      app?.canvas?.selectedNodes ||
      app?.graph?.selected_nodes ||
      null
  );
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
