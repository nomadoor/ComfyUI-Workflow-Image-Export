function normalizeWarnings(warnings) {
  return Array.from(new Set(
    (Array.isArray(warnings) ? warnings : [])
      .map((warning) => String(warning || "").trim())
      .filter(Boolean)
  ));
}

export function attachCaptureWarnings(blob, warnings) {
  if (!blob) return blob;
  const normalized = normalizeWarnings(warnings);
  if (!normalized.length) return blob;
  try {
    Object.defineProperty(blob, "cwieWarnings", {
      configurable: true,
      enumerable: false,
      value: normalized,
      writable: true,
    });
  } catch (_) {
    try {
      blob.cwieWarnings = normalized;
    } catch (_) {}
  }
  return blob;
}

export function getNode2WarningMessage(warnings) {
  const normalized = normalizeWarnings(warnings);
  if (normalized.includes("node2:transparent_recovery_failed")) {
    return "Transparent background recovery failed. The image was exported with a black background instead.";
  }
  if (normalized.includes("node2:transparent_background_unsupported")) {
    return "Transparent background is not available for tiled Node 2.0 capture. The image was exported with its captured background.";
  }
  return "";
}
