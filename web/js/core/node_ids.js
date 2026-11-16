/**
 * Mirrors ComfyUI frontend's parseNodeId()/serializeNodeId() identity rules.
 * Do not trim strings or coerce numeric-looking strings: values such as
 * "063" and 63 are intentionally different node IDs.
 */
export function toNodeIdKey(value) {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : null;
  }
  return null;
}

function nodeIdFromEntry(entry) {
  if (entry && typeof entry === "object" && "id" in entry) {
    return toNodeIdKey(entry.id);
  }
  return toNodeIdKey(entry);
}

export function normalizeNodeIdList(value) {
  let entries;
  if (value instanceof Map) {
    entries = value.keys();
  } else if (value instanceof Set || Array.isArray(value)) {
    entries = value;
  } else if (value && typeof value === "object") {
    entries = Object.keys(value);
  } else {
    return [];
  }

  const ids = [];
  for (const entry of entries) {
    const id = nodeIdFromEntry(entry);
    if (id !== null) ids.push(id);
  }
  return ids;
}

export function normalizeNodeIdSet(value) {
  const ids = new Set(normalizeNodeIdList(value));
  return ids.size > 0 ? ids : null;
}

export function nodeIdsEqual(left, right) {
  const leftKey = toNodeIdKey(left);
  return leftKey !== null && leftKey === toNodeIdKey(right);
}

export function nodeIdSetHas(ids, value) {
  const key = toNodeIdKey(value);
  return key !== null && ids?.has(key) === true;
}
