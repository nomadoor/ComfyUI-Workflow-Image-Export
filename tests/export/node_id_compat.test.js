import assert from "node:assert/strict";
import test from "node:test";

import { computeGraphBBox } from "../../web/js/export/bbox.mjs";
import { syncLiveGraphState } from "../../web/js/export/live_graph_sync.mjs";

test("selection bbox accepts arbitrary frontend string node ids", () => {
  const graph = {
    _nodes: [
      { id: "node-alpha", pos: [10, 20], size: [100, 80] },
      { id: "node-beta", pos: [500, 600], size: [200, 100] },
    ],
  };

  assert.deepEqual(
    computeGraphBBox(graph, {
      selectedNodeIds: ["node-alpha"],
      useSelectionOnly: true,
    }),
    {
      minX: 10,
      minY: 20,
      maxX: 110,
      maxY: 100,
      width: 100,
      height: 80,
      paddedMinX: 10,
      paddedMinY: 20,
    }
  );
});

test("selection bbox preserves subgraph-scoped node ids", () => {
  const graph = {
    _nodes: [
      { id: "3:5", pos: [20, 30], size: [80, 60] },
      { id: "3:6", pos: [400, 500], size: [100, 100] },
    ],
  };

  const bbox = computeGraphBBox(graph, {
    selectedNodeIds: ["3:5"],
    useSelectionOnly: true,
  });

  assert.deepEqual(
    {
      minX: bbox.minX,
      minY: bbox.minY,
      maxX: bbox.maxX,
      maxY: bbox.maxY,
    },
    { minX: 20, minY: 30, maxX: 100, maxY: 90 }
  );
});

test("configured nodes include the title when bounding geometry is not measured yet", () => {
  const node = {
    id: 1,
    pos: new Float64Array([10, 20]),
    size: new Proxy(new Float64Array([100, 80]), {}),
    getBounding() {
      return [0, 0, 0, 0];
    },
  };

  assert.deepEqual(
    computeGraphBBox({ _nodes: [node], _groups: [] }),
    {
      minX: 10,
      minY: -10,
      maxX: 110,
      maxY: 100,
      width: 100,
      height: 110,
      paddedMinX: 10,
      paddedMinY: -10,
    }
  );
});

test("configured titleless nodes use their measured body bounds", () => {
  const node = {
    id: 1,
    pos: [10, 20],
    size: [100, 80],
    getBounding() {
      return [0, 0, 0, 0];
    },
    measure(out) {
      out[0] = 10;
      out[1] = 20;
      out[2] = 100;
      out[3] = 80;
    },
  };

  const bbox = computeGraphBBox({ _nodes: [node], _groups: [] });

  assert.deepEqual(
    { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
    { minX: 10, minY: 20, maxX: 110, maxY: 100 }
  );
});

test("configured collapsed nodes use their measured collapsed bounds", () => {
  const node = {
    id: 1,
    pos: [10, 20],
    size: [400, 300],
    flags: { collapsed: true },
    getBounding() {
      return [0, 0, 0, 0];
    },
    measure(out) {
      out[0] = 10;
      out[1] = -10;
      out[2] = 80;
      out[3] = 30;
    },
  };

  const bbox = computeGraphBBox({ _nodes: [node], _groups: [] });

  assert.deepEqual(
    { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
    { minX: 10, minY: -10, maxX: 90, maxY: 20 }
  );
});

test("bbox measurement does not create a collapsed-width cache on the live node", () => {
  const node = {
    id: 1,
    pos: [10, 20],
    size: [400, 300],
    flags: { collapsed: true },
    getBounding() {
      return [0, 0, 0, 0];
    },
    measure(out) {
      // Mirrors the frontend side effect when measure() runs without a canvas
      // context before the collapsed title has ever been drawn.
      this._collapsed_width = 0;
      out[0] = 10;
      out[1] = -10;
      out[2] = 80;
      out[3] = 30;
    },
  };

  const bbox = computeGraphBBox({ _nodes: [node], _groups: [] });

  assert.equal(Object.hasOwn(node, "_collapsed_width"), false);
  assert.deepEqual(
    { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
    { minX: 10, minY: -10, maxX: 90, maxY: 20 }
  );
});

test("fast preview still measures collapsed nodes instead of using their expanded size", () => {
  const node = {
    id: 1,
    pos: [10, 20],
    size: [400, 300],
    flags: { collapsed: true },
    getBounding() {
      return [0, 0, 0, 0];
    },
    measure(out) {
      out[0] = 10;
      out[1] = -10;
      out[2] = 80;
      out[3] = 30;
    },
  };

  const bbox = computeGraphBBox(
    { _nodes: [node], _groups: [] },
    { useBounding: false }
  );

  assert.deepEqual(
    { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
    { minX: 10, minY: -10, maxX: 90, maxY: 20 }
  );
});

test("collapsed bbox preserves the live title width measured by LiteGraph", () => {
  let measureCalls = 0;
  const exportNode = {
    id: 1,
    pos: [10, 20],
    size: [400, 300],
    flags: { collapsed: true },
    _collapsed_width: 80,
    getBounding() {
      return [0, 0, 0, 0];
    },
    measure(out, ctx) {
      measureCalls += 1;
      // Current LiteGraph overwrites the cached title width when no drawing
      // context is supplied. The bbox pass must not destroy the live value.
      this._collapsed_width = ctx ? 246 : 80;
      out[0] = this.pos[0];
      out[1] = this.pos[1] - 30;
      out[2] = this._collapsed_width;
      out[3] = 30;
    },
  };
  const liveNode = {
    id: "1",
    pos: new Float64Array([10, 20]),
    size: new Float64Array([400, 300]),
    _collapsed_width: 246,
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );
  const bbox = computeGraphBBox(
    { _nodes: [exportNode], _groups: [] },
    { useBounding: false }
  );

  assert.equal(exportNode._collapsed_width, 246);
  assert.equal(measureCalls, 0);
  assert.deepEqual(
    { minX: bbox.minX, minY: bbox.minY, maxX: bbox.maxX, maxY: bbox.maxY },
    { minX: 10, minY: -10, maxX: 256, maxY: 20 }
  );
});

test("live graph sync joins serialized numeric ids to frontend string ids", () => {
  const exportWidget = { type: "customtext", value: "serialized" };
  const liveWidget = { type: "customtext", value: "live" };
  const exportNode = {
    id: 63,
    pos: [0, 0],
    size: [100, 50],
    widgets: [exportWidget],
    widgets_values: ["serialized"],
    computeSize() {
      return [110, 70];
    },
    setSize(size) {
      this.size = size;
    },
  };
  const liveNode = {
    id: "63",
    pos: [25, 35],
    size: [220, 140],
    widgets: [liveWidget],
    widgets_values: ["live"],
    properties: { current: true },
    imgs: [{ unsafeLiveMedia: true }],
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );

  assert.deepEqual(exportNode.pos, [25, 35]);
  assert.deepEqual(exportNode.size, [220, 140]);
  assert.deepEqual(exportNode.widgets_values, ["live"]);
  assert.deepEqual(exportNode.properties, { current: true });
  assert.equal(exportNode.widgets[0].value, "live");
  assert.equal(exportNode.imgs, undefined);
});

test("live graph sync preserves runtime values for subtyped textPreview widgets", () => {
  const exportWidget = { type: "textPreview:runtime-id", value: "serialized" };
  const liveWidget = { type: "textPreview:runtime-id", value: "runtime output" };
  const exportNode = {
    id: 64,
    pos: [0, 0],
    size: [240, 120],
    widgets: [exportWidget],
  };
  const liveNode = {
    id: 64,
    pos: [0, 0],
    size: [240, 120],
    widgets: [liveWidget],
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );

  assert.equal(exportWidget.value, "runtime output");
});

test("live typed-array geometry remains authoritative without clone resize writes", () => {
  let cloneLayoutWrites = 0;
  const liveSizeTarget = new Float64Array([404, 178]);
  const liveSize = new Proxy(liveSizeTarget, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const exportPosTarget = new Float64Array([100, 200]);
  const exportSizeTarget = new Float64Array([404, 178]);
  const exportSize = new Proxy(exportSizeTarget, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const exportNode = {
    id: 103,
    _pos: exportPosTarget,
    _size: exportSizeTarget,
    get pos() {
      return this._pos;
    },
    set pos(value) {
      cloneLayoutWrites += 1;
      this._pos.set(value);
    },
    get size() {
      return exportSize;
    },
    set size(value) {
      cloneLayoutWrites += 1;
      this._size.set(value);
    },
    widgets: [{ type: "customtext", value: "serialized" }],
    computeSize(out) {
      out[0] = 213;
      out[1] = 70;
      return out;
    },
    setSize(size) {
      this.size = size;
    },
  };
  const liveNode = {
    id: "103",
    pos: new Float64Array([2560, 1239]),
    size: liveSize,
    widgets: [{ type: "customtext", value: "live" }],
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );

  assert.deepEqual(Array.from(exportNode.pos), [2560, 1239]);
  assert.deepEqual(Array.from(exportNode.size), [404, 178]);
  assert.equal(cloneLayoutWrites, 0);
});

test("live typed-array group geometry remains authoritative", () => {
  let groupLayoutWrites = 0;
  const exportGroup = {
    id: "upscale",
    _pos: new Float64Array([100, 200]),
    _size: new Float64Array([300, 400]),
    get pos() {
      return this._pos;
    },
    set pos(value) {
      groupLayoutWrites += 1;
      this._pos.set(value);
    },
    get size() {
      return this._size;
    },
    set size(value) {
      groupLayoutWrites += 1;
      this._size.set(value);
    },
  };
  const liveGroup = {
    id: "upscale",
    pos: new Float64Array([4460, 750]),
    size: new Float64Array([1430, 1920]),
  };

  syncLiveGraphState(
    { _nodes: [], _groups: [exportGroup] },
    { _nodes: [], _groups: [liveGroup] },
    null
  );

  assert.deepEqual(Array.from(exportGroup.pos), [4460, 750]);
  assert.deepEqual(Array.from(exportGroup.size), [1430, 1920]);
  assert.equal(groupLayoutWrites, 0);
});

test("live sync snapshots mutable state and never runs clone computeSize", () => {
  const liveProperties = { nested: { value: "live" } };
  const liveWidgetValues = ["live"];
  let computeSizeCalls = 0;
  const exportNode = {
    id: 1,
    pos: [0, 0],
    size: [100, 50],
    properties: { nested: { value: "serialized" } },
    widgets_values: ["serialized"],
    widgets: [],
    computeSize() {
      computeSizeCalls += 1;
      this.properties.nested.value = "mutated";
      this.widgets_values[0] = "mutated";
      return [213, 70];
    },
  };
  const liveNode = {
    id: 1,
    pos: [0, 0],
    size: [100, 50],
    properties: liveProperties,
    widgets_values: liveWidgetValues,
    widgets: [],
  };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    null
  );

  assert.equal(computeSizeCalls, 0);
  assert.deepEqual(liveProperties, { nested: { value: "live" } });
  assert.deepEqual(liveWidgetValues, ["live"]);
  assert.deepEqual(exportNode.properties, liveProperties);
  assert.deepEqual(exportNode.widgets_values, liveWidgetValues);
  assert.notEqual(exportNode.properties, liveProperties);
  assert.notEqual(exportNode.properties.nested, liveProperties.nested);
  assert.notEqual(exportNode.widgets_values, liveWidgetValues);
});

test("DOM media bounds never enlarge the live node geometry", (t) => {
  const previousHTMLElement = globalThis.HTMLElement;
  const previousHTMLVideoElement = globalThis.HTMLVideoElement;
  const previousDocument = globalThis.document;
  class FakeElement {}
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLVideoElement = class extends FakeElement {};
  t.after(() => {
    globalThis.HTMLElement = previousHTMLElement;
    globalThis.HTMLVideoElement = previousHTMLVideoElement;
    globalThis.document = previousDocument;
  });

  const nodeRoot = {
    getAttribute(name) {
      return name === "data-node-id" ? "63" : null;
    },
  };
  const widget = new FakeElement();
  widget.querySelector = () => ({});
  widget.closest = () => nodeRoot;
  widget.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 100,
    height: 240,
  });
  const root = {
    querySelectorAll(selector) {
      return selector === ".dom-widget" ? [widget] : [];
    },
  };
  globalThis.document = root;
  const canvas = {
    parentElement: root,
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1000, height: 1000 };
    },
  };
  const exportNode = { id: 63, pos: [0, 0], size: [100, 50], widgets: [] };
  const liveNode = { id: "63", pos: [0, 0], size: [100, 50], widgets: [] };

  syncLiveGraphState(
    { _nodes: [exportNode], _groups: [] },
    { _nodes: [liveNode], _groups: [] },
    { canvas, ds: { scale: 1, offset: [0, 0] } }
  );

  assert.deepEqual(exportNode.size, [100, 50]);
});
