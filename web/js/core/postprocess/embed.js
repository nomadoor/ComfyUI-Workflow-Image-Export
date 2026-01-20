import { app } from "/scripts/app.js";

function sanitizeWorkflow(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const cleaned = {};
  const allow = [
    "last_node_id",
    "last_link_id",
    "nodes",
    "links",
    "groups",
    "config",
    "version",
  ];
  for (const key of allow) {
    if (key in raw) {
      cleaned[key] = raw[key];
    }
  }

  if (!Array.isArray(cleaned.nodes) || !Array.isArray(cleaned.links)) {
    return null;
  }

  return cleaned;
}

function getWorkflowJson() {
  const graph = app?.graph;
  if (!graph || typeof graph.serialize !== "function") {
    return null;
  }
  try {
    const raw = graph.serialize();
    const cleaned = sanitizeWorkflow(raw);
    if (!cleaned) {
      return JSON.stringify(raw);
    }
    return JSON.stringify(cleaned);
  } catch (error) {
    console.warn("[workflow-image-export] Failed to serialize workflow", error);
    return null;
  }
}

function createPngTextChunk(keyword, text) {
  const keywordBytes = new TextEncoder().encode(keyword);
  const textBytes = new TextEncoder().encode(text);
  const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);
  data.set(keywordBytes, 0);
  data[keywordBytes.length] = 0;
  data.set(textBytes, keywordBytes.length + 1);
  return createPngChunk("tEXt", data);
}

function createPngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = toUint32(data.length);
  const crcBytes = toUint32(crc32(concatUint8(typeBytes, data)));
  return concatUint8(lengthBytes, typeBytes, data, crcBytes);
}

function toUint32(value) {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function concatUint8(...arrays) {
  const total = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

function crc32(data) {
  const table = crc32.table || (crc32.table = buildCrc32Table());
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

async function embedWorkflowInPng(blob, workflowJson) {
  const buffer = await blob.arrayBuffer();
  const data = new Uint8Array(buffer);
  const signature = "\x89PNG\r\n\x1a\n";
  for (let i = 0; i < signature.length; i += 1) {
    if (data[i] !== signature.charCodeAt(i)) {
      return blob;
    }
  }

  const chunk = createPngTextChunk("workflow", workflowJson);
  let offset = 8;
  while (offset + 8 <= data.length) {
    const length =
      (data[offset] << 24) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3];
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7]
    );
    if (type === "IEND") {
      const before = data.subarray(0, offset);
      const after = data.subarray(offset);
      const merged = concatUint8(before, chunk, after);
      return new Blob([merged], { type: "image/png" });
    }
    offset += 12 + length;
  }
  return blob;
}

export async function embedWorkflow(result, options = {}) {
  if (!result || result.type !== "raster") {
    return result;
  }
  if (!options.embedWorkflow) {
    return result;
  }

  const workflowJson = getWorkflowJson();
  if (!workflowJson) {
    return result;
  }

  if (result.mime === "image/png") {
    const blob = await embedWorkflowInPng(result.blob, workflowJson);
    return { ...result, blob };
  }

  return result;
}
