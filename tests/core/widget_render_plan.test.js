import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWidgetRenderPlan,
  collectPlannedWidgetIndexes,
  installPlannedWidgetDrawSuppression,
  joinWidgetRenderPlanToGraph,
} from "../../web/js/core/backends/widget_render_plan.mjs";

class MockElement {
  constructor({ matches = [], children = new Map(), style = {} } = {}) {
    this.matchingSelectors = new Set(matches);
    this.children = children;
    this.mockStyle = style;
    this.parentElement = null;
  }

  matches(selectors) {
    return selectors.split(",").some((selector) => this.matchingSelectors.has(selector.trim()));
  }

  querySelector(selectors) {
    for (const selector of selectors.split(",").map((value) => value.trim())) {
      if (this.children.has(selector)) return this.children.get(selector);
    }
    return null;
  }
}

class MockTextAreaElement extends MockElement {}

function multilineNode(id, type) {
  return {
    id,
    type,
    title: type,
    pos: [10, 20],
    size: [240, 140],
    widgets_values: ["line one\nline two"],
    widgets: [
      {
        type: "string",
        name: "text",
        value: "line one\nline two",
        y: 30,
        computedHeight: 90,
        margin: 4,
        options: { multiline: true },
      },
    ],
  };
}

test.beforeEach(() => {
  globalThis.HTMLTextAreaElement = MockTextAreaElement;
  globalThis.window = {
    LiteGraph: {
      NODE_FONT: "Arial",
      NODE_TEXT_COLOR: "#eeeeee",
      NODE_TITLE_HEIGHT: 30,
      WIDGET_BGCOLOR: "#222222",
    },
    getComputedStyle(element) {
      return {
        fontSize: element.mockStyle.fontSize || "12px",
        lineHeight: element.mockStyle.lineHeight || "16px",
        paddingLeft: "2px",
        paddingTop: "3px",
        paddingRight: "2px",
        paddingBottom: "3px",
        backgroundColor: "rgb(20, 20, 20)",
        color: "#dddddd",
        fontStyle: "",
        fontVariant: "",
        fontWeight: "400",
        fontFamily: "sans-serif",
      };
    },
  };
  globalThis.document = { body: {} };
});

test.afterEach(() => {
  delete globalThis.HTMLTextAreaElement;
  delete globalThis.window;
  delete globalThis.document;
});

test("Note and CLIPTextEncode multiline widgets produce the same single-entry shape", () => {
  const notePlan = buildWidgetRenderPlan({
    graph: { nodes: [multilineNode(1, "Note")] },
    allowDom: true,
  });
  const clipPlan = buildWidgetRenderPlan({
    graph: { nodes: [multilineNode(2, "CLIPTextEncode")] },
    allowDom: true,
  });

  assert.equal(notePlan.length, 1);
  assert.equal(clipPlan.length, 1);
  assert.deepEqual(
    { ...notePlan[0], key: "same", nodeId: 0 },
    { ...clipPlan[0], key: "same", nodeId: 0 }
  );
  assert.equal(notePlan[0].source, "text");
  assert.equal(notePlan[0].styleSource, "default");
});

test("ordinary single-line widgets do not enter the overlay plan", () => {
  const graph = {
    nodes: [{
      id: 3,
      type: "SaveImage",
      pos: [0, 0],
      size: [240, 100],
      widgets_values: ["ComfyUI"],
      widgets: [{
        type: "text",
        name: "filename_prefix",
        value: "ComfyUI",
        y: 30,
        options: {},
      }],
    }],
  };

  assert.deepEqual(buildWidgetRenderPlan({ graph, allowDom: false }), []);
});

test("missing widget.element still produces exactly one default-style text entry", () => {
  const plan = buildWidgetRenderPlan({
    graph: { nodes: [multilineNode(7, "CLIPTextEncode")] },
    uiCanvas: { nodeRects: [] },
    allowDom: true,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "text");
  assert.equal(plan[0].styleSource, "default");
  assert.equal(plan[0].element, null);
  assert.equal(plan[0].style.background, "#222222");
});

test("legacy runtime typed-array geometry and string node ids produce a plan entry", () => {
  const textarea = new MockTextAreaElement();
  const graph = {
    nodes: [{
      id: "72",
      type: "TextEncodeJoyImageEdit",
      title: "TextEncodeJoyImageEdit",
      pos: new Float32Array([100, 200]),
      size: new Float32Array([400, 260]),
      widgets: [{
        name: "prompt",
        type: "customtext",
        value: "runtime prompt",
        y: 30,
        computedHeight: 200,
        margin: 10,
        options: {
          hideOnZoom: true,
          minNodeSize: [400, 200],
        },
        element: textarea,
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: true });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, "72:0");
  assert.equal(plan[0].source, "text");
  assert.equal(plan[0].styleSource, "dom");
  assert.deepEqual(plan[0].graphRect, {
    x: 110,
    y: 240,
    w: 380,
    h: 180,
  });
  assert.deepEqual(plan[0].nodeGraphRect, {
    x: 100,
    y: 200,
    w: 400,
    h: 260,
  });
});

test("widgets without an explicit margin use the frontend default of ten", () => {
  const node = multilineNode(73, "TextEncode");
  delete node.widgets[0].margin;
  const [entry] = buildWidgetRenderPlan({
    graph: { nodes: [node] },
    allowDom: false,
  });

  assert.deepEqual(entry.graphRect, {
    x: 20,
    y: 60,
    w: 220,
    h: 70,
  });
});

test("serialized array fallback is ignored when widget cardinality differs", () => {
  const node = multilineNode(74, "TextEncode");
  delete node.widgets[0].value;
  node.widgets_values = ["wrong value", "shifted value"];
  const [entry] = buildWidgetRenderPlan({
    graph: { nodes: [node] },
    allowDom: false,
  });

  assert.equal(entry.text, "");
});

test("DOM-to-node lookup inputs cannot change plan entry count", () => {
  const graph = { nodes: [multilineNode(8, "Anything")] };
  const withoutCanvas = buildWidgetRenderPlan({ graph, allowDom: true });
  const withUnresolvableCanvas = buildWidgetRenderPlan({
    graph,
    uiCanvas: { nodeRects: [], canvas: { dataset: {} } },
    allowDom: true,
  });

  assert.equal(withoutCanvas.length, 1);
  assert.equal(withUnresolvableCanvas.length, 1);
  assert.deepEqual(withUnresolvableCanvas, withoutCanvas);
});

test("a textarea without comfy-multiline-input is classified as DOM-styled text", () => {
  const textarea = new MockTextAreaElement();
  const node = multilineNode(9, "Custom");
  node.widgets[0].options = {};
  node.widgets[0].type = "string";
  node.widgets[0].element = textarea;

  const plan = buildWidgetRenderPlan({ graph: { nodes: [node] }, allowDom: true });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "text");
  assert.equal(plan[0].styleSource, "dom");
  assert.equal(plan[0].element, textarea);
});

test("allowDom false preserves entry count and forces text with default style", () => {
  const textarea = new MockTextAreaElement();
  const multiline = multilineNode(10, "CLIPTextEncode");
  multiline.widgets[0].element = textarea;
  const markdown = {
    id: 11,
    type: "MarkdownNode",
    pos: [0, 0],
    size: [220, 120],
    widgets: [{
      type: "markdown",
      value: "# title",
      y: 30,
      computedHeight: 80,
      margin: 4,
      element: new MockElement({ matches: [".comfy-markdown-content"] }),
    }],
  };
  const graph = { nodes: [multiline, markdown] };

  const domPlan = buildWidgetRenderPlan({ graph, allowDom: true });
  const noDomPlan = buildWidgetRenderPlan({ graph, allowDom: false });

  assert.equal(noDomPlan.length, domPlan.length);
  assert.ok(noDomPlan.every((entry) => entry.source === "text"));
  assert.ok(noDomPlan.every((entry) => entry.styleSource === "default"));
  assert.ok(noDomPlan.every((entry) => entry.element === null));
});

test("skipWidgetCapture immediately downgrades markdown within the same entry", () => {
  const markdownElement = new MockElement({ matches: [".comfy-markdown-content"] });
  const graph = {
    nodes: [{
      id: 12,
      pos: [0, 0],
      size: [220, 120],
      widgets: [{
        type: "markdown",
        value: "# title",
        y: 30,
        computedHeight: 80,
        margin: 4,
        element: markdownElement,
      }],
    }],
  };

  const capturePlan = buildWidgetRenderPlan({ graph, allowDom: true });
  const safePlan = buildWidgetRenderPlan({
    graph,
    allowDom: true,
    options: { skipWidgetCapture: true },
  });

  assert.equal(capturePlan.length, 1);
  assert.equal(capturePlan[0].source, "capture");
  assert.equal(capturePlan[0].styleSource, "dom");
  assert.equal(safePlan.length, 1);
  assert.equal(safePlan[0].key, capturePlan[0].key);
  assert.equal(safePlan[0].source, "text");
  assert.equal(safePlan[0].styleSource, "default");
  assert.equal(safePlan[0].element, null);
});

test("media entries retain ownedElement only as a delegation hint", () => {
  const media = new MockElement();
  const container = new MockElement({ children: new Map([["canvas", media]]) });
  const graph = {
    nodes: [{
      id: 13,
      pos: [0, 0],
      size: [220, 120],
      widgets: [{
        type: "preview",
        y: 30,
        computedHeight: 80,
        margin: 4,
        element: container,
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: true });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].ownedElement, container);
  assert.equal(plan[0].element, media);
});

test("selection filtering happens while the plan is built", () => {
  const graph = {
    nodes: [
      multilineNode(21, "Note"),
      multilineNode(22, "CLIPTextEncode"),
    ],
  };
  const plan = buildWidgetRenderPlan({
    graph,
    allowDom: false,
    options: {
      selectedNodeIds: [22],
      renderFilter: "selected",
    },
  });

  assert.deepEqual(plan.map((entry) => entry.nodeId), [22]);
});

test("hidden, collapsed, and node-filtered widgets never enter the plan", () => {
  const hiddenWidgetNode = multilineNode(23, "Note");
  hiddenWidgetNode.widgets[0].hidden = true;
  const hiddenTypeNode = multilineNode(24, "Note");
  hiddenTypeNode.widgets[0].type = "hidden";
  const disabledNode = multilineNode(28, "Note");
  disabledNode.widgets[0].computedDisabled = true;
  const collapsedNode = multilineNode(25, "Note");
  collapsedNode.flags = { collapsed: true };
  const filteredNode = multilineNode(26, "Note");
  filteredNode.isWidgetVisible = () => false;
  const visibleNode = multilineNode(27, "Note");
  visibleNode.isWidgetVisible = () => true;

  const plan = buildWidgetRenderPlan({
    graph: {
      nodes: [
        hiddenWidgetNode,
        hiddenTypeNode,
        disabledNode,
        collapsedNode,
        filteredNode,
        visibleNode,
      ],
    },
    allowDom: false,
  });

  assert.deepEqual(plan.map((entry) => entry.nodeId), [27]);
});

test("plan joins to an export graph only by node id and widget index", () => {
  const plan = buildWidgetRenderPlan({
    graph: { nodes: [multilineNode(31, "Note"), multilineNode(32, "Note")] },
    allowDom: false,
  });
  const logs = [];
  const joined = joinWidgetRenderPlanToGraph(
    plan,
    {
      nodes: [{
        id: 32,
        pos: [100, 200],
        size: [300, 180],
        widgets: [{
          y: 40,
          computedHeight: 100,
          margin: 10,
        }],
      }],
    },
    (label, payload) => logs.push({ label, payload })
  );

  assert.deepEqual(joined.map((entry) => entry.key), ["32:0"]);
  assert.deepEqual(joined[0].graphRect, {
    x: 110,
    y: 250,
    w: 280,
    h: 80,
  });
  assert.deepEqual(logs, [{
    label: "widget.plan.join",
    payload: { input: 2, joined: 1, dropped: 1 },
  }]);

  const cloneNode = {
    id: 32,
    pos: [100, 200],
    size: [300, 220],
    widgets: [{
      y: 50,
      computedHeight: 140,
      margin: 10,
    }],
  };
  const refreshed = joinWidgetRenderPlanToGraph(joined, {
    nodes: [cloneNode],
  });
  assert.deepEqual(refreshed[0].graphRect, {
    x: 110,
    y: 260,
    w: 280,
    h: 120,
  });
});

test("only entries that can paint claim native widget draw ownership", () => {
  const indexes = collectPlannedWidgetIndexes([
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text", text: "owned" },
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text", text: "owned" },
    { key: "72:1", nodeId: "72", widgetIndex: 1, source: "media", text: "media" },
    { key: "72:2", nodeId: "72", widgetIndex: 2, source: "text", text: "  " },
    { key: "72:3", nodeId: "72", widgetIndex: 3, source: "capture", text: "" },
  ]);

  assert.deepEqual([...indexes.get("72")], [0, 3]);
});

test("offscreen suppression filters planned widgets synchronously and restores the instance", () => {
  const textWidget = { type: "customtext" };
  const mediaWidget = { type: "image" };
  const widgets = [textWidget, mediaWidget];
  const node = { id: "72", widgets };
  const seenWidgets = [];
  const canvasPrototype = {
    drawNodeWidgets(currentNode) {
      seenWidgets.push([...currentNode.widgets]);
      return "drawn";
    },
  };
  const canvas = Object.create(canvasPrototype);
  const suppression = installPlannedWidgetDrawSuppression(canvas, [
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text", text: "owned" },
    { key: "72:1", nodeId: "72", widgetIndex: 1, source: "media", text: "media" },
  ]);

  assert.equal(suppression.suppressed, 1);
  assert.equal(canvas.drawNodeWidgets(node), "drawn");
  assert.deepEqual(seenWidgets, [[mediaWidget]]);
  assert.equal(node.widgets, widgets);
  assert.equal(textWidget.type, "customtext");
  assert.equal(Object.hasOwn(canvas, "drawNodeWidgets"), true);

  suppression.restore();
  suppression.restore();
  assert.equal(Object.hasOwn(canvas, "drawNodeWidgets"), false);
  assert.equal(canvas.drawNodeWidgets, canvasPrototype.drawNodeWidgets);
});

test("offscreen suppression restores node widgets when base drawing throws", () => {
  const widgets = [{ type: "customtext" }, { type: "image" }];
  const node = { id: 72, widgets };
  const ownDraw = function () {
    throw new Error("draw failed");
  };
  const canvas = { drawNodeWidgets: ownDraw };
  const originalDescriptor = Object.getOwnPropertyDescriptor(canvas, "drawNodeWidgets");
  const suppression = installPlannedWidgetDrawSuppression(canvas, [
    { key: "72:0", nodeId: 72, widgetIndex: 0, source: "text", text: "owned" },
  ]);

  assert.throws(() => canvas.drawNodeWidgets(node), /draw failed/);
  assert.equal(node.widgets, widgets);
  suppression.restore();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(canvas, "drawNodeWidgets"),
    originalDescriptor
  );
});

test("parallel suppression sessions never mutate their shared live widgets", () => {
  const widgets = [{ type: "customtext", draw() {} }];
  const node = { id: 72, widgets };
  const makeCanvas = () => ({
    drawNodeWidgets(currentNode) {
      assert.deepEqual(currentNode.widgets, []);
    },
  });
  const plan = [
    { key: "72:0", nodeId: 72, widgetIndex: 0, source: "text", text: "owned" },
  ];
  const firstCanvas = makeCanvas();
  const secondCanvas = makeCanvas();
  const first = installPlannedWidgetDrawSuppression(firstCanvas, plan);
  const second = installPlannedWidgetDrawSuppression(secondCanvas, plan);

  firstCanvas.drawNodeWidgets(node);
  secondCanvas.drawNodeWidgets(node);
  first.restore();
  second.restore();

  assert.equal(node.widgets, widgets);
  assert.equal(widgets[0].type, "customtext");
});
