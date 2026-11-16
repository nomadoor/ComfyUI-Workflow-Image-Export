export function sanitizeFilename(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveWorkflowName({ graph = null, documentTitle = "" } = {}) {
  const candidates = [
    graph?.name,
    graph?.title,
    graph?.workflow_name,
    graph?.workflowName,
    graph?.extra?.workflow_name,
    graph?.extra?.name,
    graph?.config?.name,
    graph?.config?.title,
    graph?._config?.name,
    graph?._config?.title,
  ];
  for (const candidate of candidates) {
    const cleaned = sanitizeFilename(candidate);
    if (cleaned) return cleaned;
  }
  const docTitle = sanitizeFilename(documentTitle);
  if (docTitle) {
    const stripped = docTitle.replace(/\s*-\s*ComfyUI\s*$/i, "").trim();
    if (stripped) return stripped;
  }
  return "workflow";
}

export function resolveBlobExtension(blob, fallbackFormat = "png") {
  const hint = blob?.cwieFormat;
  if (typeof hint === "string" && hint.trim()) {
    return hint.trim().toLowerCase();
  }
  const type = String(blob?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("svg")) return "svg";
  return fallbackFormat || "png";
}
