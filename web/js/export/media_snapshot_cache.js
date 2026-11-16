function snapshotKey(kind, nodeId) {
  return `${String(kind)}:${String(nodeId)}`;
}

export function hasMediaSnapshot(cache, kind, nodeId) {
  return cache instanceof Map && cache.has(snapshotKey(kind, nodeId));
}

export function readMediaSnapshot(cache, kind, nodeId) {
  if (!(cache instanceof Map)) return undefined;
  return cache.get(snapshotKey(kind, nodeId));
}

export function createOriginCleanMediaSnapshot(media) {
  const width = Math.ceil(Number(
    media?.videoWidth || media?.naturalWidth || media?.width
  ));
  const height = Math.ceil(Number(
    media?.videoHeight || media?.naturalHeight || media?.height
  ));
  if (!media || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return null;
    ctx.drawImage(media, 0, 0, width, height);
    ctx.getImageData(0, 0, 1, 1);
    return canvas;
  } catch (_) {
    return null;
  }
}

export async function resolveMediaSnapshot(
  cache,
  kind,
  nodeId,
  resolve,
  snapshot = (value) => value
) {
  if (!(cache instanceof Map)) {
    return resolve();
  }
  const key = snapshotKey(kind, nodeId);
  if (cache.has(key)) {
    return cache.get(key);
  }

  const pending = Promise.resolve()
    .then(resolve)
    .then((value) => value == null ? null : snapshot(value));
  cache.set(key, pending);
  try {
    const resolvedSnapshot = await pending;
    cache.set(key, resolvedSnapshot ?? null);
    return resolvedSnapshot ?? null;
  } catch (error) {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  }
}
