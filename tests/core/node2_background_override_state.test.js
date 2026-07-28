import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackgroundOverrideState,
} from "../../web/js/core/backends/node2_background_override_state.mjs";

test("apply, setColor, and restore preserve the state before the first apply", async () => {
  const target = {
    documentBgImg: "url(original)",
    background: "original background",
    backgroundColor: "rgb(1, 2, 3)",
    clearBackgroundColor: "#123456",
  };
  let saved = null;
  let saveCount = 0;
  const override = createBackgroundOverrideState({
    saveOriginal() {
      saveCount += 1;
      saved = { ...target };
    },
    writeColor(color) {
      target.documentBgImg = `url(${color})`;
      target.background = color;
      target.backgroundColor = color;
      target.clearBackgroundColor = "transparent";
    },
    restoreOriginal() {
      Object.assign(target, saved);
    },
  });

  await override.apply("#000000");
  await override.setColor("#ffffff");
  await override.restore();

  assert.equal(saveCount, 1);
  assert.deepEqual(target, {
    documentBgImg: "url(original)",
    background: "original background",
    backgroundColor: "rgb(1, 2, 3)",
    clearBackgroundColor: "#123456",
  });
});

test("setColor rejects use before apply", async () => {
  const override = createBackgroundOverrideState();
  await assert.rejects(
    override.setColor("#ffffff"),
    /must be applied/
  );
});
