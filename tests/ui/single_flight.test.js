import test from "node:test";
import assert from "node:assert/strict";

import { runSingleFlight } from "../../web/js/ui/single_flight.mjs";

test("concurrent export attempts share one operation and allow a later retry", async () => {
  const sharedState = {};
  let starts = 0;
  let finish;
  const operation = () => {
    starts += 1;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };

  const first = runSingleFlight(sharedState, "export", operation);
  const second = runSingleFlight(sharedState, "export", operation);

  assert.strictEqual(first, second);
  assert.equal(starts, 1);
  finish("done");
  assert.equal(await first, "done");

  const third = runSingleFlight(sharedState, "export", async () => {
    starts += 1;
    return "retry";
  });
  assert.equal(await third, "retry");
  assert.equal(starts, 2);
});

test("failed export attempts release the shared guard", async () => {
  const sharedState = {};

  await assert.rejects(
    runSingleFlight(sharedState, "export", async () => {
      throw new Error("failed");
    }),
    /failed/
  );
  assert.equal(sharedState.export, undefined);
});
