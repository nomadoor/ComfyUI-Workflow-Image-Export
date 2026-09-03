import test from "node:test";
import assert from "node:assert/strict";

import {
  buildOffscreenWidgetRenderPlan,
  buildWidgetRenderPlan,
  collectPlannedMediaElements,
  collectPlannedMediaNodeIds,
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
    const requested = new Set(selectors.split(",").map((value) => value.trim()));
    for (const [selector, element] of this.children) {
      if (requested.has(selector)) return element;
    }
    return null;
  }

  querySelectorAll(selectors) {
    const requested = new Set(selectors.split(",").map((value) => value.trim()));
    const found = [];
    for (const [selector, element] of this.children) {
      if (requested.has(selector) && !found.includes(element)) found.push(element);
    }
    return found;
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

test("ComfyUI textPreview widgets produce a multiline text entry", () => {
  const graph = {
    nodes: [{
      id: 4,
      type: "PreviewAny",
      pos: [0, 0],
      size: [240, 120],
      widgets: [{
        type: "textPreview",
        name: "preview_text",
        value: "Hallo",
        y: 30,
        computedHeight: 70,
        margin: 4,
        options: {},
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: false });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "text");
  assert.equal(plan[0].text, "Hallo");
});

test("runtime-subtyped textPreview widgets remain multiline text", () => {
  const graph = {
    nodes: [{
      id: 41,
      type: "PreviewAny",
      pos: [0, 0],
      size: [240, 120],
      widgets: [{
        type: "textPreview:runtime-id",
        name: "preview_text",
        value: "runtime text",
        y: 30,
        computedHeight: 70,
        margin: 4,
        options: {},
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: false });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "text");
  assert.equal(plan[0].text, "runtime text");
});

test("dynamic multiline widgets render primitive integer values as text", () => {
  const node = multilineNode(5, "ShowText");
  node.widgets = [
    {
      ...node.widgets[0],
      name: "text_0",
      value: 12,
    },
    {
      ...node.widgets[0],
      name: "text_1",
      value: 34,
      y: 80,
    },
  ];
  node.widgets_values = [[12, 34]];

  const plan = buildWidgetRenderPlan({
    graph: { nodes: [node] },
    allowDom: false,
  });

  assert.deepEqual(plan.map((entry) => entry.text), ["12", "34"]);
});

test("offscreen planning retains live-only dynamic multiline widgets", () => {
  const makeWidget = (name, value, y) => ({
    type: "customtext",
    name,
    value,
    y,
    computedHeight: 40,
    margin: 4,
    options: { multiline: true },
    element: new MockTextAreaElement(),
  });
  const liveGraph = {
    nodes: [{
      id: 42,
      pos: [10, 20],
      size: [240, 140],
      widgets: [
        makeWidget("text_0", 12, 30),
        makeWidget("text_1", 34, 75),
      ],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 42,
      pos: [100, 200],
      size: [240, 140],
      widgets: [],
    }],
  };
  const expected = [
    { text: "12", graphRect: { x: 104, y: 234, w: 232, h: 32 } },
    { text: "34", graphRect: { x: 104, y: 279, w: 232, h: 32 } },
  ];

  for (const includeDomOverlays of [true, false]) {
    const plan = buildOffscreenWidgetRenderPlan({
      liveGraph,
      exportGraph,
      includeDomOverlays,
    });

    assert.deepEqual(
      plan.map(({ text, graphRect }) => ({ text, graphRect })),
      expected
    );
    if (includeDomOverlays === false) {
      assert.ok(plan.every((entry) => entry.styleSource === "default"));
      assert.ok(plan.every((entry) => entry.element === null));
      assert.ok(plan.every((entry) => entry.ownedElement === null));
    }
  }
});

test("offscreen planning retains a live-only ComfyUI textPreview widget", () => {
  const liveGraph = {
    nodes: [{
      id: 142,
      pos: [10, 20],
      size: [240, 140],
      widgets: [{
        type: "textPreview",
        name: "preview_text",
        value: "runtime output",
        y: 30,
        computedHeight: 40,
        margin: 4,
        options: {},
      }],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 142,
      pos: [100, 200],
      size: [240, 140],
      widgets: [],
    }],
  };

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: false,
  });

  assert.deepEqual(
    plan.map(({ text, graphRect, widgetIndex }) => ({ text, graphRect, widgetIndex })),
    [{
      text: "runtime output",
      graphRect: { x: 104, y: 234, w: 232, h: 32 },
      widgetIndex: null,
    }]
  );
});

test("live-only text never claims an unrelated partial-clone widget", () => {
  const makeTextWidget = (name, value, y) => ({
    type: "customtext",
    name,
    value,
    y,
    computedHeight: 40,
    margin: 4,
    options: { multiline: true },
  });
  const liveGraph = {
    nodes: [{
      id: 43,
      pos: [10, 20],
      size: [240, 140],
      widgets: [
        makeTextWidget("text_0", 12, 30),
        makeTextWidget("text_1", 34, 75),
      ],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 43,
      pos: [100, 200],
      size: [240, 140],
      widgets: [{
        type: "button",
        name: "converted_input",
        y: 5,
        computedHeight: 20,
        margin: 4,
      }],
    }],
  };
  const expected = [
    { text: "12", graphRect: { x: 104, y: 234, w: 232, h: 32 } },
    { text: "34", graphRect: { x: 104, y: 279, w: 232, h: 32 } },
  ];

  for (const includeDomOverlays of [true, false]) {
    const plan = buildOffscreenWidgetRenderPlan({
      liveGraph,
      exportGraph,
      includeDomOverlays,
    });

    assert.deepEqual(
      plan.map(({ text, graphRect }) => ({ text, graphRect })),
      expected
    );
    assert.equal(collectPlannedWidgetIndexes(plan).has("43"), false);
  }
});

test("live text does not trust a same-name clone widget with no type", () => {
  const liveGraph = {
    nodes: [{
      id: 44,
      pos: [10, 20],
      size: [240, 100],
      widgets: [{
        type: "customtext",
        name: "text_0",
        value: 12,
        y: 30,
        computedHeight: 40,
        margin: 4,
        options: { multiline: true },
      }],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 44,
      pos: [100, 200],
      size: [240, 100],
      widgets: [{
        name: "text_0",
        y: 5,
        computedHeight: 20,
        margin: 4,
      }],
    }],
  };
  const expected = [{
    text: "12",
    graphRect: { x: 104, y: 234, w: 232, h: 32 },
  }];

  for (const includeDomOverlays of [true, false]) {
    const plan = buildOffscreenWidgetRenderPlan({
      liveGraph,
      exportGraph,
      includeDomOverlays,
    });

    assert.deepEqual(
      plan.map(({ text, graphRect }) => ({ text, graphRect })),
      expected
    );
    assert.equal(collectPlannedWidgetIndexes(plan).has("44"), false);
  }
});

test("multiline widgets do not stringify arbitrary object values", () => {
  const node = multilineNode(6, "ShowText");
  node.widgets[0].value = { id: 12 };
  node.widgets_values = [{ id: 12 }];

  const [entry] = buildWidgetRenderPlan({
    graph: { nodes: [node] },
    allowDom: false,
  });

  assert.equal(entry.text, "");
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
  assert.equal(plan[0].mediaDelegationEligible, true);
  assert.equal(plan[0].ownedElement, container);
  assert.equal(plan[0].element, media);
});

test("DOM-free tiled planning retains live widget media by identity", () => {
  const media = new MockElement();
  const container = new MockElement({ children: new Map([["canvas", media]]) });
  const liveGraph = {
    nodes: [{
      id: "41",
      pos: [10, 20],
      size: [240, 180],
      widgets: [{
        type: "preview:pano-7",
        y: 40,
        computedHeight: 120,
        margin: 10,
        element: container,
      }],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 41,
      pos: [10, 20],
      size: [240, 180],
      widgets: [{
        type: "preview:pano-7",
        y: 40,
        computedHeight: 120,
        margin: 10,
      }],
    }],
  };

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: false,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, "41:0");
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].element, media);
  assert.deepEqual(plan[0].graphRect, { x: 20, y: 70, w: 220, h: 100 });
});

test("offscreen planning retains transient live media absent from the clone", () => {
  const media = new MockElement();
  media.width = 320;
  media.height = 180;
  const container = new MockElement({ children: new Map([["canvas", media]]) });
  const liveGraph = {
    nodes: [{
      id: 45,
      pos: [10, 20],
      size: [240, 180],
      widgets: [{
        type: "preview:pano-9",
        y: 40,
        computedHeight: 120,
        margin: 10,
        element: container,
      }],
    }],
  };
  const exportNode = {
    id: "45",
    pos: [100, 200],
    size: [240, 180],
    widgets: [],
  };

  const plans = [true, false].map((includeDomOverlays) =>
    buildOffscreenWidgetRenderPlan({
      liveGraph,
      exportGraph: { nodes: [exportNode] },
      includeDomOverlays,
    })
  );

  for (const plan of plans) {
    assert.equal(plan.length, 1);
    assert.equal(plan[0].key, "45:live-media:0");
    assert.equal(plan[0].widgetIndex, null);
    assert.equal(plan[0].liveWidgetIndex, 0);
    assert.equal(plan[0].element, media);
    assert.deepEqual(plan[0].graphRect, { x: 110, y: 250, w: 220, h: 100 });
    assert.deepEqual(plan[0].nodeGraphRect, { x: 100, y: 200, w: 240, h: 180 });
  }

  exportNode.pos = [120, 230];
  const refreshed = joinWidgetRenderPlanToGraph(plans[0], { nodes: [exportNode] });
  assert.deepEqual(refreshed[0].graphRect, { x: 130, y: 280, w: 220, h: 100 });
});

test("transient live media never claims a shifted ordinary clone widget", () => {
  const media = new MockElement();
  media.width = 320;
  media.height = 180;
  const container = new MockElement({ children: new Map([["canvas", media]]) });
  const liveGraph = {
    nodes: [{
      id: 46,
      pos: [10, 20],
      size: [240, 180],
      widgets: [
        {
          name: "transient_preview",
          type: "preview:pano-10",
          y: 40,
          computedHeight: 120,
          margin: 10,
          element: container,
        },
        {
          name: "filename_prefix",
          type: "text",
          value: "output",
          y: 165,
          computedHeight: 20,
          margin: 4,
        },
      ],
    }],
  };
  const ordinaryCloneWidget = {
    name: "filename_prefix",
    type: "text",
    value: "output",
    y: 30,
    computedHeight: 20,
    margin: 4,
  };
  const exportNode = {
    id: "46",
    pos: [100, 200],
    size: [240, 180],
    widgets: [ordinaryCloneWidget],
  };

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph: { nodes: [exportNode] },
    includeDomOverlays: false,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, "46:live-media:0");
  assert.equal(plan[0].widgetIndex, null);
  assert.equal(plan[0].liveWidgetIndex, 0);
  assert.deepEqual(plan[0].graphRect, { x: 110, y: 250, w: 220, h: 100 });
  assert.equal(collectPlannedWidgetIndexes(plan).has("46"), false);

  const seenWidgets = [];
  const canvas = {
    drawNodeWidgets(node) {
      seenWidgets.push([...node.widgets]);
    },
  };
  const suppression = installPlannedWidgetDrawSuppression(canvas, plan);
  canvas.drawNodeWidgets(exportNode);
  suppression.restore();
  assert.deepEqual(seenWidgets, [[ordinaryCloneWidget]]);
});

test("arbitrary dynamic media subtypes stay live-relative and suppress clone media once", () => {
  const makeMediaWidget = (element, y) => ({
    name: "preview",
    type: "preview:runtime-alpha",
    y,
    computedHeight: 70,
    margin: 10,
    element: new MockElement({ children: new Map([["canvas", element]]) }),
  });
  const firstMedia = new MockElement();
  firstMedia.width = 100;
  firstMedia.height = 60;
  const secondMedia = new MockElement();
  secondMedia.width = 100;
  secondMedia.height = 60;
  const liveGraph = {
    nodes: [{
      id: 47,
      pos: [10, 20],
      size: [240, 200],
      widgets: [
        makeMediaWidget(firstMedia, 40),
        makeMediaWidget(secondMedia, 120),
      ],
    }],
  };
  const cloneMediaWidget = {
    name: "preview",
    type: "preview:runtime-beta",
    y: 40,
    computedHeight: 70,
    margin: 10,
  };
  const exportNode = {
    id: "47",
    pos: [100, 200],
    size: [240, 200],
    widgets: [cloneMediaWidget],
  };
  const cloneOnlyPlan = buildWidgetRenderPlan({
    graph: { nodes: [exportNode] },
    allowDom: false,
  });
  assert.equal(cloneOnlyPlan[0].source, "media");
  assert.equal(cloneOnlyPlan[0].widgetIndex, 0);

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph: { nodes: [exportNode] },
    includeDomOverlays: false,
  });

  assert.deepEqual(plan.map((entry) => entry.key), [
    "47:live-media:0",
    "47:live-media:1",
  ]);
  assert.deepEqual(plan.map((entry) => entry.widgetIndex), [null, null]);
  assert.deepEqual(plan.map((entry) => entry.element), [firstMedia, secondMedia]);
  assert.deepEqual(plan.map((entry) => entry.suppressedCloneWidgetIndexes), [[0], []]);
  assert.deepEqual([...collectPlannedWidgetIndexes(plan).get("47")], [0]);

  const seenWidgets = [];
  const canvas = {
    drawNodeWidgets(node) {
      seenWidgets.push([...node.widgets]);
    },
  };
  const suppression = installPlannedWidgetDrawSuppression(canvas, plan);
  canvas.drawNodeWidgets(exportNode);
  suppression.restore();
  assert.deepEqual(seenWidgets, [[]]);
});

test("type-only live media wrappers cannot displace clone placeholder ownership", () => {
  const wrapper = new MockElement();
  const liveGraph = {
    nodes: [{
      id: 48,
      pos: [10, 20],
      size: [240, 180],
      widgets: [
        {
          name: "preview",
          type: "preview",
          y: 40,
          computedHeight: 100,
          margin: 10,
          element: wrapper,
        },
        {
          name: "runtime_only",
          type: "button",
          y: 145,
          computedHeight: 20,
        },
      ],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: "48",
      pos: [100, 200],
      size: [240, 180],
      widgets: [{
        name: "preview",
        type: "preview",
        y: 40,
        computedHeight: 100,
        margin: 10,
      }],
    }],
  };

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: false,
  });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].key, "48:0");
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].element, null);
  assert.equal(plan[0].mediaDelegationEligible, false);
  assert.deepEqual([...collectPlannedWidgetIndexes(plan).get("48")], [0]);
});

test("transient live media cannot displace unrelated clone media", () => {
  const media = new MockElement();
  media.width = 320;
  media.height = 180;
  const liveGraph = {
    nodes: [{
      id: 49,
      pos: [10, 20],
      size: [240, 180],
      widgets: [{
        name: "panorama",
        type: "preview:pano-14",
        y: 40,
        computedHeight: 100,
        margin: 10,
        element: new MockElement({ children: new Map([["canvas", media]]) }),
      }],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: "49",
      pos: [100, 200],
      size: [240, 180],
      widgets: [{
        name: "video_preview",
        type: "video",
        y: 40,
        computedHeight: 100,
        margin: 10,
      }],
    }],
  };

  const plan = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: false,
  });

  assert.deepEqual(plan.map((entry) => entry.key), [
    "49:0",
    "49:live-media:0",
  ]);
  assert.equal(plan[0].element, null);
  assert.equal(plan[1].element, media);
  assert.deepEqual(plan[1].suppressedCloneWidgetIndexes, []);
  assert.deepEqual([...collectPlannedWidgetIndexes(plan).get("49")], [0]);
});

test("one concrete duplicate media suppresses only one clone duplicate", () => {
  const media = new MockElement();
  media.width = 320;
  media.height = 180;
  const sharedWidget = {
    name: "preview",
    type: "preview",
    computedHeight: 70,
    margin: 10,
  };
  const liveGraph = {
    nodes: [{
      id: 50,
      pos: [10, 20],
      size: [240, 200],
      widgets: [
        {
          ...sharedWidget,
          y: 40,
          element: new MockElement({ children: new Map([["canvas", media]]) }),
        },
        {
          ...sharedWidget,
          y: 120,
          element: new MockElement(),
        },
      ],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: "50",
      pos: [100, 200],
      size: [240, 200],
      widgets: [
        { ...sharedWidget, y: 40 },
        { ...sharedWidget, y: 120 },
      ],
    }],
  };

  for (const includeDomOverlays of [false, true]) {
    const plan = buildOffscreenWidgetRenderPlan({
      liveGraph,
      exportGraph,
      includeDomOverlays,
    });
    const byKey = new Map(plan.map((entry) => [entry.key, entry]));

    assert.deepEqual([...byKey.keys()].sort(), [
      "50:1",
      "50:live-media:0",
    ]);
    assert.equal(byKey.get("50:1").mediaDelegationEligible, false);
    assert.equal(byKey.get("50:live-media:0").element, media);
    assert.deepEqual(
      byKey.get("50:live-media:0").suppressedCloneWidgetIndexes,
      [0]
    );
    assert.deepEqual(
      [...collectPlannedWidgetIndexes(plan).get("50")].sort(),
      [0, 1]
    );
  }
});

test("planned widget media owns every media element in its DOM subtree", () => {
  const video = new MockElement();
  const image = new MockElement();
  const wrapper = new MockElement({
    children: new Map([
      ["video", video],
      ["img", image],
    ]),
  });
  const unrelated = new MockElement();

  const owned = collectPlannedMediaElements([
    {
      key: "41:0",
      nodeId: 41,
      widgetIndex: 0,
      source: "media",
      ownedElement: wrapper,
      element: video,
    },
    {
      key: "42:0",
      nodeId: 42,
      widgetIndex: 0,
      source: "text",
      ownedElement: unrelated,
      element: unrelated,
    },
  ]);

  assert.deepEqual([...owned], [video, image]);
  assert.equal(owned.has(wrapper), false);
  assert.equal(owned.has(unrelated), false);
  assert.deepEqual([...collectPlannedMediaNodeIds([
    { source: "media", nodeId: 41 },
    { source: "media", nodeId: "41" },
    { source: "text", nodeId: 42 },
  ])], ["41"]);
});

test("VHS-style nested video and image remain under one planned widget owner", () => {
  const video = new MockElement();
  const image = new MockElement();
  video.hidden = true;
  image.hidden = false;
  const wrapper = new MockElement({
    children: new Map([
      ["video", video],
      ["img", image],
    ]),
  });
  const graph = {
    nodes: [{
      id: 51,
      type: "VHS_LoadVideo",
      pos: [0, 0],
      size: [240, 180],
      widgets: [{
        name: "videopreview",
        type: "preview",
        y: 40,
        computedHeight: 120,
        margin: 10,
        element: wrapper,
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: true });
  const owned = collectPlannedMediaElements(plan);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].element, image);
  assert.equal(owned.has(video), true);
  assert.equal(owned.has(image), true);
  assert.equal(owned.size, 2);
});

test("VHS active media and clone geometry match in non-huge and huge plans", () => {
  const video = new MockElement();
  const image = new MockElement();
  video.hidden = true;
  image.hidden = false;
  image.naturalWidth = 320;
  image.naturalHeight = 180;
  const wrapper = new MockElement({
    children: new Map([
      ["video", video],
      ["img", image],
    ]),
  });
  const liveGraph = {
    nodes: [{
      id: "61",
      type: "VHS_LoadVideo",
      pos: [5, 10],
      size: [260, 190],
      widgets: [{
        name: "videopreview",
        type: "preview",
        y: 45,
        computedHeight: 130,
        margin: 10,
        element: wrapper,
      }],
    }],
  };
  const exportGraph = {
    nodes: [{
      id: 61,
      type: "VHS_LoadVideo",
      pos: [100, 200],
      size: [300, 220],
      widgets: [{
        name: "videopreview",
        type: "preview",
        y: 50,
        computedHeight: 150,
        margin: 10,
      }],
    }],
  };

  const nonHuge = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: true,
  });
  const huge = buildOffscreenWidgetRenderPlan({
    liveGraph,
    exportGraph,
    includeDomOverlays: false,
  });

  for (const plan of [nonHuge, huge]) {
    assert.equal(plan.length, 1);
    assert.equal(plan[0].key, "61:0");
    assert.equal(plan[0].element, image);
    assert.deepEqual(plan[0].graphRect, { x: 110, y: 260, w: 280, h: 130 });
  }
});

test("type-only media wrappers are not eligible for DOM media delegation", () => {
  const wrapper = new MockElement();
  const graph = {
    nodes: [{
      id: 131,
      pos: [0, 0],
      size: [220, 120],
      widgets: [{
        type: "preview",
        y: 30,
        computedHeight: 80,
        margin: 4,
        element: wrapper,
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: true });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].ownedElement, wrapper);
  assert.equal(plan[0].element, wrapper);
  assert.equal(plan[0].mediaDelegationEligible, false);
});

test("DOM-free media plans suppress native media without inventing a text fallback", () => {
  const graph = {
    nodes: [{
      id: 14,
      pos: [0, 0],
      size: [220, 120],
      widgets: [{
        type: "preview",
        y: 30,
        computedHeight: 80,
        margin: 4,
      }],
    }],
  };

  const plan = buildWidgetRenderPlan({ graph, allowDom: false });

  assert.equal(plan.length, 1);
  assert.equal(plan[0].source, "media");
  assert.equal(plan[0].element, null);
  assert.equal(plan[0].mediaDelegationEligible, false);
  assert.deepEqual([...collectPlannedWidgetIndexes(plan).get("14")], [0]);
});

test("colon-delimited canvas and image runtime types use their media family", () => {
  for (const [index, type] of ["canvas:runtime-42", "image:session-7"].entries()) {
    const plan = buildWidgetRenderPlan({
      graph: {
        nodes: [{
          id: 140 + index,
          pos: [0, 0],
          size: [220, 120],
          widgets: [{
            name: "media",
            type,
            y: 30,
            computedHeight: 80,
            margin: 4,
          }],
        }],
      },
      allowDom: false,
    });

    assert.equal(plan.length, 1);
    assert.equal(plan[0].source, "media");
    assert.equal(plan[0].mediaDelegationEligible, false);
  }
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

test("planned text, capture, and delegated media claim native widget draw ownership", () => {
  const indexes = collectPlannedWidgetIndexes([
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text", text: "owned" },
    { key: "72:0", nodeId: "72", widgetIndex: 0, source: "text", text: "owned" },
    { key: "72:1", nodeId: "72", widgetIndex: 1, source: "media", text: "media" },
    { key: "72:2", nodeId: "72", widgetIndex: 2, source: "text", text: "  " },
    { key: "72:3", nodeId: "72", widgetIndex: 3, source: "capture", text: "" },
  ]);

  assert.deepEqual([...indexes.get("72")], [0, 1, 3]);
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

  assert.equal(suppression.suppressed, 2);
  assert.equal(canvas.drawNodeWidgets(node), "drawn");
  assert.deepEqual(seenWidgets, [[]]);
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
