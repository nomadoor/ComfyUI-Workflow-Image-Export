import { toUint32, concatUint8, crc32 } from "../core/utils.js";

function createPngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = toUint32(data.length);
  const crcBytes = toUint32(crc32(concatUint8(typeBytes, data)));
  return concatUint8(lengthBytes, typeBytes, data, crcBytes);
}

function createPngTextChunk(keyword, text) {
  const keywordBytes = new TextEncoder().encode(keyword);
  for (const byte of keywordBytes) {
    if (byte > 0x7f) {
      throw new Error("iTXt keyword must be Latin-1/ASCII");
    }
  }
  const textBytes = new TextEncoder().encode(text);
  const languageTagBytes = new Uint8Array(0);
  const translatedKeywordBytes = new Uint8Array(0);
  const data = new Uint8Array(
    keywordBytes.length +
      1 +
      1 +
      1 +
      languageTagBytes.length +
      1 +
      translatedKeywordBytes.length +
      1 +
      textBytes.length
  );
  let offset = 0;
  data.set(keywordBytes, offset);
  offset += keywordBytes.length;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  data[offset] = 0;
  offset += 1;
  if (languageTagBytes.length) {
    data.set(languageTagBytes, offset);
    offset += languageTagBytes.length;
  }
  data[offset] = 0;
  offset += 1;
  if (translatedKeywordBytes.length) {
    data.set(translatedKeywordBytes, offset);
    offset += translatedKeywordBytes.length;
  }
  data[offset] = 0;
  offset += 1;
  data.set(textBytes, offset);
  return createPngChunk("iTXt", data);
}

export async function embedWorkflowInPngBlob(blob, workflowJson) {
  if (!blob || !workflowJson) {
    return blob;
  }
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
