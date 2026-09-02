import test from "node:test";
import assert from "node:assert/strict";

import { createLiveRenderGuard } from "../../web/js/core/backends/live_render_guard.mjs";

test("legacy offscreen drawing cannot leave live geometry or DOM layout mutated", () => {
  const element = {
    style: { cssText: "width: 100px; transform: translate(1px, 2px);" },
    hidden: false,
  };
  const root = {
    querySelectorAll() {
      return [element];
    },
  };
  const node = {
    pos: [10, 20],
    size: [200, 120],
    widgets: [{ y: 30, height: 40, computedHeight: 40 }],
  };
  const guard = createLiveRenderGuard(
    { _nodes: [node] },
    { canvas: { closest: () => root, parentElement: root } }
  );

  node.pos[0] = 999;
  node.size = [800, 600];
  node.widgets[0].y = 300;
  node.widgets[0].height = 400;
  node.widgets[0].computedHeight = 500;
  element.style.cssText = "width: 9999px; transform: scaleX(20);";
  element.hidden = true;

  guard.restore();

  assert.deepEqual(node.pos, [10, 20]);
  assert.deepEqual(node.size, [200, 120]);
  assert.deepEqual(node.widgets[0], { y: 30, height: 40, computedHeight: 40 });
  assert.equal(element.style.cssText, "width: 100px; transform: translate(1px, 2px);");
  assert.equal(element.hidden, false);
});

test("guard tolerates sparse widgets and removes render-only state", () => {
  const widget = { y: 30 };
  const node = {
    pos: [10, 20],
    size: [200, 120],
    widgets: [null, widget],
  };
  const guard = createLiveRenderGuard({ _nodes: [node] }, null);

  node._pos = [999, 999];
  node._size = [800, 600];
  widget.last_y = 300;
  widget.computedDisabled = true;

  guard.restore();

  assert.equal(Object.hasOwn(node, "_pos"), false);
  assert.equal(Object.hasOwn(node, "_size"), false);
  assert.equal(Object.hasOwn(widget, "last_y"), false);
  assert.equal(Object.hasOwn(widget, "computedDisabled"), false);
});

test("guard detaches only the temporary graph canvas", () => {
  const liveCanvas = { name: "live" };
  const offscreen = { name: "offscreen" };
  const laterCanvas = { name: "later" };
  const graph = {
    list_of_graphcanvas: [liveCanvas],
    primaryCanvas: liveCanvas,
    detached: [],
    detachCanvas(canvas) {
      this.detached.push(canvas);
      const index = this.list_of_graphcanvas.indexOf(canvas);
      if (index >= 0) this.list_of_graphcanvas.splice(index, 1);
    },
  };
  const guard = createLiveRenderGuard(graph, null);
  graph.list_of_graphcanvas.push(offscreen);
  graph.primaryCanvas = offscreen;
  guard.trackGraphCanvas(offscreen);
  graph.list_of_graphcanvas.push(laterCanvas);

  guard.restore();

  assert.deepEqual(graph.detached, [offscreen]);
  assert.deepEqual(graph.list_of_graphcanvas, [liveCanvas, laterCanvas]);
  assert.equal(graph.primaryCanvas, liveCanvas);
});

test("guard removes a canvas attached by a throwing constructor", () => {
  const liveCanvas = { name: "live" };
  const leakedCanvas = { name: "constructor-partial" };
  const graph = { list_of_graphcanvas: [liveCanvas], primaryCanvas: liveCanvas };
  const guard = createLiveRenderGuard(graph, null);
  graph.list_of_graphcanvas.push(leakedCanvas);
  graph.primaryCanvas = leakedCanvas;

  guard.restore();

  assert.deepEqual(graph.list_of_graphcanvas, [liveCanvas]);
  assert.equal(graph.primaryCanvas, liveCanvas);
});

test("guard restores absent graph canvas bookkeeping", () => {
  const leakedCanvas = { name: "constructor-partial" };
  const graph = {};
  const guard = createLiveRenderGuard(graph, null);
  graph.list_of_graphcanvas = [leakedCanvas];
  graph.primaryCanvas = leakedCanvas;

  guard.restore();

  assert.equal(Object.hasOwn(graph, "list_of_graphcanvas"), false);
  assert.equal(Object.hasOwn(graph, "primaryCanvas"), false);
});
