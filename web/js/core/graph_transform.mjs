export function graphPointToCanvas(point, transform) {
  const scale = Number(transform?.scale);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offset = Array.isArray(transform?.offset) ? transform.offset : [0, 0];
  const x = Number(point?.x ?? point?.[0] ?? 0);
  const y = Number(point?.y ?? point?.[1] ?? 0);
  return [
    (x + Number(offset[0] || 0)) * safeScale,
    (y + Number(offset[1] || 0)) * safeScale,
  ];
}

export function canvasPointToGraph(point, transform) {
  const scale = Number(transform?.scale);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const offset = Array.isArray(transform?.offset) ? transform.offset : [0, 0];
  const x = Number(point?.x ?? point?.[0] ?? 0);
  const y = Number(point?.y ?? point?.[1] ?? 0);
  return [
    x / safeScale - Number(offset[0] || 0),
    y / safeScale - Number(offset[1] || 0),
  ];
}

export function createExportDragAndScale(bounds, scale = 1) {
  const s = Number(scale);
  const safeScale = Number.isFinite(s) && s > 0 ? s : 1;
  const left = Number(bounds?.left ?? bounds?.minX ?? 0);
  const top = Number(bounds?.top ?? bounds?.minY ?? 0);
  return {
    scale: safeScale,
    offset: [-left, -top],
  };
}

export function graphRectToExportRect(rect, bounds, scale = 1) {
  const s = Number(scale);
  const safeScale = Number.isFinite(s) && s > 0 ? s : 1;
  const left = Number(bounds?.left ?? bounds?.minX ?? 0);
  const top = Number(bounds?.top ?? bounds?.minY ?? 0);
  return {
    x: (Number(rect?.x ?? rect?.left ?? 0) - left) * safeScale,
    y: (Number(rect?.y ?? rect?.top ?? 0) - top) * safeScale,
    w: Number(rect?.w ?? rect?.width ?? 0) * safeScale,
    h: Number(rect?.h ?? rect?.height ?? 0) * safeScale,
  };
}
