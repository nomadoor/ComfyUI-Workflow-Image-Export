import test from "node:test";
import assert from "node:assert/strict";

import { captureClassicRenderModel } from "../../web/js/export/classic_render_model.mjs";

test("Classic render model freezes live widget text and geometry at export start", async () => {
  const widget = {
    name: "text",
    type: "customtext",
    value: "snapshot text",
    y: 30,
    computedHeight: 90,
    margin: 4,
    options: { multiline: true },
  };
  const node = {
    id: 7,
    pos: new Float32Array([10, 20]),
    size: new Float32Array([240, 140]),
    widgets: [widget],
  };

  const model = await captureClassicRenderModel({ graph: { nodes: [node] } });
  widget.value = "changed later";
  widget.computedHeight = 0;
  node.pos[0] = 999;
  node.widgets.splice(0, 1);

  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.widgetPlan), true);
  assert.equal(Object.isFrozen(model.widgetPlan[0]), true);
  assert.equal(model.widgetPlan[0].text, "snapshot text");
  assert.deepEqual(model.widgetInventory, [{
    nodeId: 7,
    widgets: [{ name: "text", type: "customtext" }],
  }]);
  assert.deepEqual(model.widgetPlan[0].graphRect, { x: 14, y: 54, w: 232, h: 82 });
  assert.deepEqual(model.widgetPlan[0].nodeGraphRect, { x: 10, y: 20, w: 240, h: 140 });
});
