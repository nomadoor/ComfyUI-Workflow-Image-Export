import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWidgetRenderPlan,
  joinWidgetRenderPlanToGraph,
  suppressPlannedWidgetDrawing,
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

test("plan joins to an export graph only by node id and widget index", () => {
  const plan = buildWidgetRenderPlan({
    graph: { nodes: [multilineNode(31, "Note"), multilineNode(32, "Note")] },
    allowDom: false,
  });
  const joined = joinWidgetRenderPlanToGraph(plan, {
    nodes: [{ id: 32, widgets: [{}] }],
  });

  assert.deepEqual(joined.map((entry) => entry.key), ["32:0"]);
});

test("planned text widgets cannot draw natively during the base graph pass", () => {
  const inheritedDraw = () => "inherited";
  const widgetPrototype = { draw: inheritedDraw };
  const textWidget = Object.assign(Object.create(widgetPrototype), {
    type: "customtext",
    value: "owned text",
  });
  const mediaDraw = () => "media";
  const mediaWidget = { type: "image", draw: mediaDraw };
  const graph = {
    _nodes: [{
      id: "72",
      widgets: [textWidget, mediaWidget],
    }],
  };
  const suppression = suppressPlannedWidgetDrawing(graph, [
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text" },
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text" },
    { key: "72:1", nodeId: "72", widgetIndex: 1, source: "media" },
  ]);

  assert.equal(suppression.suppressed, 1);
  assert.equal(textWidget.type, "hidden");
  assert.equal(textWidget.draw(), undefined);
  assert.equal(mediaWidget.draw, mediaDraw);

  suppression.restore();
  assert.equal(textWidget.type, "customtext");
  assert.equal(textWidget.draw, inheritedDraw);
  assert.equal(Object.hasOwn(textWidget, "draw"), false);
});
