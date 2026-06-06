import { wrapText } from "./legacy_text_helpers.mjs";

export function drawWidgetTextFallback({ exportCtx, graph, bounds, scale, coveredNodeIds, debugLog }) {
  const nodes = graph?._nodes || graph?.nodes || [];
  if (!nodes.length) {
    return { drawn: 0, skippedCovered: 0, skippedEmpty: 0 };
  }

  let drawn = 0;
  let skippedCovered = 0;
  let skippedEmpty = 0;

  const getNodeTextCandidate = (node) => {
    const candidates = [];
    if (Array.isArray(node.widgets_values)) {
      for (const value of node.widgets_values) {
        if (typeof value === "string" && value.trim()) {
          candidates.push(value);
        }
      }
    }
    if (node.properties && typeof node.properties === "object") {
      for (const [key, value] of Object.entries(node.properties)) {
        if (typeof value === "string" && value.trim()) {
          const lower = key.toLowerCase();
          if (
            lower.includes("text") ||
            lower.includes("prompt") ||
            lower.includes("note") ||
            lower.includes("markdown")
          ) {
            candidates.push(value);
          }
        }
      }
    }
    if (!candidates.length) return "";
    const sorted = candidates.sort((a, b) => b.length - a.length);
    return sorted[0];
  };

  for (const node of nodes) {
    if (!node) continue;
    if (coveredNodeIds?.has?.(node.id)) {
      skippedCovered += 1;
      continue;
    }
    let drewForNode = false;
    const widgetsValues = Array.isArray(node.widgets_values)
      ? node.widgets_values
      : node.widgets_values && typeof node.widgets_values === "object"
        ? node.widgets_values
        : null;
    const nodePos = node.pos || node._pos || [0, 0];
    const nodeSize = node.size || node._size || [0, 0];
    const widgetBaseX = nodePos[0] + 15;
    const widgetWidth = Math.max(1, (nodeSize[0] || 0) - 30);
    const widgetsStartY =
      Number.isFinite(node.widgets_start_y) ? node.widgets_start_y : 0;

    const widgets = Array.isArray(node.widgets) ? node.widgets : [];
    if (debugLog) {
      debugLog("text.fallback.node", {
        id: node.id,
        type: node.type,
        title: node.title,
        pos: nodePos,
        size: nodeSize,
        widgets_len: widgets.length,
        widgets_start_y: widgetsStartY,
        widgets_values_type: Array.isArray(widgetsValues)
          ? "array"
          : widgetsValues && typeof widgetsValues === "object"
            ? "object"
            : typeof widgetsValues,
        widgets_values_keys: widgetsValues && typeof widgetsValues === "object"
          ? Object.keys(widgetsValues).slice(0, 20)
          : null,
        properties_keys: node.properties && typeof node.properties === "object"
          ? Object.keys(node.properties).slice(0, 20)
          : null,
      });
    }
    const standardWidgetTypes = ["string", "combo", "number", "toggle", "button", "slider"];
    const multilineWidgetTypes = ["textarea", "markdown", "customtext"];
    for (let index = 0; index < widgets.length; index += 1) {
      const widget = widgets[index];
      if (!widget) continue;

      const isMultiline =
        widget?.options?.multiline === true ||
        (widget.type && multilineWidgetTypes.includes(widget.type.toLowerCase()));

      if (debugLog && (node.type === "Note" || node.title?.includes("Note") || node.type?.includes("Markdown"))) {
        debugLog("text.fallback.inspect", {
          id: node.id,
          type: node.type,
          widgetType: widget.type,
          isMultiline,
          value: widget.value,
          syncedValue: widgetsValues?.[index],
        });
      }

      if (!isMultiline) continue;

      const widgetValue =
        typeof widget.value === "string" && widget.value.trim()
          ? widget.value
          : typeof widgetsValues?.[index] === "string"
            ? widgetsValues[index]
            : "";
      const fontSize = Math.max(10, Math.round(11 * scale));
      const lineHeight = Math.max(fontSize * 1.2, 12 * scale);
      const paddingX = 6 * scale;
      const paddingY = 4 * scale;

      let widgetY = Number.isFinite(widget.y) ? widget.y : widgetsStartY;
      let widgetHeight = Number.isFinite(widget.height) && widget.height > 0
        ? widget.height
        : 0;

      if (widgetHeight < fontSize * 2) {
        widgetHeight = Math.max(fontSize * 3, nodeSize[1] - widgetY - 5);
      }

      const x = (widgetBaseX - bounds.left) * scale;
      const y = (nodePos[1] + widgetY - bounds.top) * scale;
      const w = widgetWidth * scale;
      const h = widgetHeight * scale;

      const innerX = x + paddingX;
      const innerY = y + paddingY;
      const innerW = Math.max(1, w - paddingX * 2);
      const innerH = Math.max(1, h - paddingY * 2);
      const maxLines = Math.max(1, Math.floor(innerH / lineHeight) + 1);

      debugLog?.("widget.text.draw_attempt", {
        value: widgetValue.slice(0, 50),
        x: innerX,
        y: innerY,
        w: innerW,
        lines: maxLines,
        font: exportCtx.font,
        fill: exportCtx.fillStyle,
      });

      exportCtx.save();
      exportCtx.textBaseline = "top";
      exportCtx.font = `${fontSize}px ${window?.LiteGraph?.NODE_FONT || "sans-serif"}`;
      exportCtx.fillStyle = "#FFFFFF";

      exportCtx.beginPath();
      exportCtx.rect(x, y, w, h);
      exportCtx.clip();

      wrapText(exportCtx, widgetValue, innerX, innerY, innerW, lineHeight, maxLines);
      exportCtx.restore();

      drawn += 1;
      drewForNode = true;
      debugLog?.("widget.text.fallback", {
        node: { id: node.id, title: node.title, type: node.type },
        x,
        y,
        w,
        h,
      });
    }

    if (!drewForNode) {
      const candidate = getNodeTextCandidate(node);
      const typeLower = (node.type || "").toLowerCase();
      const titleLower = (node.title || "").toLowerCase();
      const isNoteNode =
        typeLower === "note" ||
        typeLower === "notes" ||
        typeLower.includes("note") ||
        titleLower.includes("note") ||
        titleLower.includes("comment");

      const hasStandardWidgets = widgets.some((w) =>
        w && standardWidgetTypes.includes(w.type) && !w.options?.multiline
      );

      if (candidate && (isNoteNode || !hasStandardWidgets || candidate.includes("\n") || candidate.length > 0)) {
        if (!isNoteNode && hasStandardWidgets && !candidate.includes("\n")) {
          // Standard single-line widgets are drawn by LiteGraph.
        } else {
          const titleHeight = window?.LiteGraph?.NODE_TITLE_HEIGHT || 30;
          const x = (widgetBaseX - bounds.left) * scale;
          const y = (nodePos[1] + titleHeight - bounds.top) * scale;
          const w = widgetWidth * scale;
          const h = Math.max(1, (nodeSize[1] - titleHeight - 6) * scale);
          const fontSize = Math.max(10, Math.round(11 * scale));
          const lineHeight = Math.max(fontSize * 1.2, 12 * scale);
          const paddingX = 6 * scale;
          const paddingY = 4 * scale;

          exportCtx.save();
          exportCtx.textBaseline = "top";
          exportCtx.font = `${fontSize}px ${window?.LiteGraph?.NODE_FONT || "sans-serif"}`;
          exportCtx.fillStyle = "#e6e6e6";
          exportCtx.beginPath();
          exportCtx.rect(x, y, w, h);
          exportCtx.clip();

          const innerX = x + paddingX;
          const innerY = y + paddingY;
          const innerW = Math.max(1, w - paddingX * 2);
          const innerH = Math.max(1, h - paddingY * 2);
          const maxLines = Math.max(1, Math.floor(innerH / lineHeight));
          wrapText(exportCtx, candidate, innerX, innerY, innerW, lineHeight, maxLines);
          exportCtx.restore();

          drawn += 1;
          debugLog?.("widget.text.generic", {
            node: { id: node.id, title: node.title, type: node.type },
            x,
            y,
            w,
            h,
          });
        }
      }
    }
  }
  return { drawn, skippedCovered, skippedEmpty };
}
