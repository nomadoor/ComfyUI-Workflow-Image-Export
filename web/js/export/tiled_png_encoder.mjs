import { toUint32, concatUint8, crc32 } from "../core/utils.mjs";
import { TILE_SIZE } from "./limits.mjs";

const ADLER_MOD = 65521;
const ADLER_NMAX = 5552;

export function clampPngCompression(value) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return 6;
  return Math.min(9, Math.max(0, num));
}

async function resolvePako() {
  if (window?.pako) return window.pako;
  try {
    const mod = await import("../vendor/pako.min.mjs");
    return mod?.default || mod?.pako || window?.pako || null;
  } catch (_) {
    return null;
  }
}

function createPngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const lengthBytes = toUint32(data.length);
  const crcBytes = toUint32(crc32(concatUint8(typeBytes, data)));
  return concatUint8(lengthBytes, typeBytes, data, crcBytes);
}

function adler32Update(state, data) {
  let a = state.a;
  let b = state.b;
  let index = 0;
  const len = data.length;
  while (index < len) {
    const end = Math.min(index + ADLER_NMAX, len);
    for (; index < end; index += 1) {
      a += data[index];
      b += a;
    }
    a %= ADLER_MOD;
    b %= ADLER_MOD;
  }
  state.a = a;
  state.b = b;
}

function createStoreDeflateStream() {
  if (typeof TransformStream === "undefined") {
    return null;
  }
  const MAX_BLOCK = 0xffff;
  const adler = { a: 1, b: 0 };
  let block = new Uint8Array(MAX_BLOCK);
  let blockLen = 0;

  const flushBlock = (controller, isFinal) => {
    const len = blockLen;
    const header = new Uint8Array(5 + len);
    header[0] = isFinal ? 0x01 : 0x00;
    header[1] = len & 0xff;
    header[2] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    header[3] = nlen & 0xff;
    header[4] = (nlen >>> 8) & 0xff;
    if (len > 0) {
      header.set(block.subarray(0, len), 5);
    }
    controller.enqueue(header);
    blockLen = 0;
  };

  return new TransformStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x78, 0x01]));
    },
    transform(chunk, controller) {
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      adler32Update(adler, data);
      let offset = 0;
      while (offset < data.length) {
        const space = MAX_BLOCK - blockLen;
        const take = Math.min(space, data.length - offset);
        block.set(data.subarray(offset, offset + take), blockLen);
        blockLen += take;
        offset += take;
        if (blockLen === MAX_BLOCK) {
          flushBlock(controller, false);
        }
      }
    },
    flush(controller) {
      flushBlock(controller, true);
      const adlerValue = (adler.b << 16) | adler.a;
      controller.enqueue(toUint32(adlerValue >>> 0));
    },
  });
}

export async function encodePngFromTiles(width, height, renderTile, onProgress, perfLog, compressionLevel) {
  const level = clampPngCompression(compressionLevel);
  const useStored = level === 0;
  const storedStream = useStored ? createStoreDeflateStream() : null;
  const useStoredStream = Boolean(storedStream);
  const pako = useStoredStream ? null : await resolvePako();
  const usePako = Boolean(pako);
  const hasCompressionStream = typeof CompressionStream !== "undefined";
  if (!useStoredStream && !usePako && !hasCompressionStream) {
    throw new Error("CompressionStream not available for tiled PNG export.");
  }
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr.set(toUint32(width), 0);
  ihdr.set(toUint32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const ihdrChunk = createPngChunk("IHDR", ihdr);

  const tilesX = Math.ceil(width / TILE_SIZE);
  const tilesY = Math.ceil(height / TILE_SIZE);
  const totalTiles = Math.max(1, tilesX * tilesY);
  perfLog?.("tile.encode.start", {
    width,
    height,
    tilesX,
    tilesY,
    totalTiles,
    compression: level,
    encoder: useStoredStream ? "store" : usePako ? "pako" : "stream",
  });
  let completedTiles = 0;

  if (usePako) {
    const deflater = new pako.Deflate({ level });
    const chunks = [];
    deflater.onData = (chunk) => {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    };

    for (let tileY = 0; tileY < height; tileY += TILE_SIZE) {
      const tileH = Math.min(TILE_SIZE, height - tileY);
      const rowTiles = [];
      for (let tileX = 0; tileX < width; tileX += TILE_SIZE) {
        const tileW = Math.min(TILE_SIZE, width - tileX);
        const tileCanvas = await renderTile(tileX, tileY, tileW, tileH);
        const tileCtx = tileCanvas.getContext("2d", { alpha: true });
        if (!tileCtx) {
          throw new Error("tile context unavailable");
        }
        const data = tileCtx.getImageData(0, 0, tileW, tileH).data;
        rowTiles.push({ tileW, data });
        completedTiles += 1;
        if (onProgress) {
          onProgress(completedTiles / totalTiles);
        }
      }
      for (let row = 0; row < tileH; row += 1) {
        const line = new Uint8Array(1 + width * 4);
        line[0] = 0;
        let offset = 1;
        for (const tile of rowTiles) {
          const start = row * tile.tileW * 4;
          const end = start + tile.tileW * 4;
          line.set(tile.data.subarray(start, end), offset);
          offset += tile.tileW * 4;
        }
        deflater.push(line, false);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    deflater.push(new Uint8Array(0), true);
    if (deflater.err) {
      throw new Error(deflater.msg || "pako deflate failed");
    }
    const compressed = concatUint8(...chunks);
    const idatChunk = createPngChunk("IDAT", compressed);
    const iendChunk = createPngChunk("IEND", new Uint8Array());
    const png = concatUint8(signature, ihdrChunk, idatChunk, iendChunk);
    perfLog?.("tile.encode.done");
    return new Blob([png], { type: "image/png" });
  }

  const rawStream = new ReadableStream({
    start(controller) {
      (async () => {
        for (let tileY = 0; tileY < height; tileY += TILE_SIZE) {
          const tileH = Math.min(TILE_SIZE, height - tileY);
          const rowTiles = [];
          for (let tileX = 0; tileX < width; tileX += TILE_SIZE) {
            const tileW = Math.min(TILE_SIZE, width - tileX);
            const tileCanvas = await renderTile(tileX, tileY, tileW, tileH);
            const tileCtx = tileCanvas.getContext("2d", { alpha: true });
            if (!tileCtx) {
              controller.error(new Error("tile context unavailable"));
              return;
            }
            const data = tileCtx.getImageData(0, 0, tileW, tileH).data;
            rowTiles.push({ tileW, data });
            completedTiles += 1;
            if (onProgress) {
              onProgress(completedTiles / totalTiles);
            }
          }
          for (let row = 0; row < tileH; row += 1) {
            const line = new Uint8Array(1 + width * 4);
            line[0] = 0;
            let offset = 1;
            for (const tile of rowTiles) {
              const start = row * tile.tileW * 4;
              const end = start + tile.tileW * 4;
              line.set(tile.data.subarray(start, end), offset);
              offset += tile.tileW * 4;
            }
            controller.enqueue(line);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        controller.close();
      })().catch((err) => controller.error(err));
    },
  });

  const compressed = await timeSpan(
    perfLog,
    useStoredStream ? "tile.encode.store" : "tile.encode.compress",
    () => {
      const stream = useStoredStream
        ? rawStream.pipeThrough(storedStream)
        : rawStream.pipeThrough(new CompressionStream("deflate"));
      return new Response(stream).arrayBuffer();
    }
  );

  const idatChunk = createPngChunk("IDAT", new Uint8Array(compressed));
  const iendChunk = createPngChunk("IEND", new Uint8Array());
  const png = concatUint8(signature, ihdrChunk, idatChunk, iendChunk);
  perfLog?.("tile.encode.done");
  return new Blob([png], { type: "image/png" });
}

function timeSpan(log, label, fn) {
  if (!log) return fn();
  const t0 = typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
  const result = fn();
  return Promise.resolve(result).finally(() => {
    const now = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    log(label, { ms: Math.round(now - t0) });
  });
}
