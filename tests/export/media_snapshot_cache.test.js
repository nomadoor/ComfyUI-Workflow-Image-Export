import test from "node:test";
import assert from "node:assert/strict";

import {
  createOriginCleanMediaSnapshot,
  resolveMediaSnapshot,
} from "../../web/js/export/media_snapshot_cache.mjs";

test("media snapshots are resolved once and shared by every tile", async () => {
  const cache = new Map();
  const snapshot = { width: 320, height: 180 };
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    return snapshot;
  };

  const first = await resolveMediaSnapshot(cache, "video", 42, resolve);
  const second = await resolveMediaSnapshot(cache, "video", 42, resolve);

  assert.equal(first, snapshot);
  assert.equal(second, snapshot);
  assert.equal(calls, 1);
});

test("snapshot conversion also runs only once", async () => {
  const cache = new Map();
  let resolves = 0;
  let snapshots = 0;
  const resolve = async () => {
    resolves += 1;
    return { frame: resolves };
  };
  const snapshot = (drawable) => {
    snapshots += 1;
    return { copiedFrame: drawable.frame };
  };

  const first = await resolveMediaSnapshot(cache, "video", 9, resolve, snapshot);
  const second = await resolveMediaSnapshot(cache, "video", 9, resolve, snapshot);

  assert.equal(first, second);
  assert.deepEqual(first, { copiedFrame: 1 });
  assert.equal(resolves, 1);
  assert.equal(snapshots, 1);
});

test("a missing snapshot stays consistently missing across tiles", async () => {
  const cache = new Map();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    return null;
  };

  assert.equal(await resolveMediaSnapshot(cache, "image", "node-1", resolve), null);
  assert.equal(await resolveMediaSnapshot(cache, "image", "node-1", resolve), null);
  assert.equal(calls, 1);
});

test("different media kinds do not share a snapshot key", async () => {
  const cache = new Map();

  assert.equal(
    await resolveMediaSnapshot(cache, "image", 7, async () => "image"),
    "image"
  );
  assert.equal(
    await resolveMediaSnapshot(cache, "video", 7, async () => "video"),
    "video"
  );
});

test("origin-clean snapshots copy a live drawable into a stable canvas", () => {
  const previousDocument = globalThis.document;
  const source = { width: 2, height: 1, frame: 1 };
  const copied = [];
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = { width: 0, height: 0, copiedFrame: null };
      canvas.getContext = () => ({
        drawImage(media) {
          canvas.copiedFrame = media.frame;
          copied.push(media.frame);
        },
        getImageData() {
          return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
        },
      });
      return canvas;
    },
  };
  try {
    const snapshot = createOriginCleanMediaSnapshot(source);
    source.frame = 2;
    assert.equal(snapshot.copiedFrame, 1);
    assert.deepEqual(copied, [1]);
  } finally {
    globalThis.document = previousDocument;
  }
});

test("tainted media is rejected instead of entering the shared tile cache", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() {
              throw new Error("tainted");
            },
          };
        },
      };
    },
  };
  try {
    assert.equal(
      createOriginCleanMediaSnapshot({ width: 16, height: 9 }),
      null
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
