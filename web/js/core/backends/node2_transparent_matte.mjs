function getFrameSignature(frame) {
  return String(frame?.frame?.signature || "");
}

function addResource(resources, canvas) {
  if (canvas) resources.add(canvas);
  return canvas;
}

export function getNode2TransparentWarning(options = {}, report = null) {
  if (options.background !== "transparent") return null;
  if (
    report?.transparentRecovery?.attempted === true &&
    report.transparentRecovery.ok !== true
  ) {
    return "node2:transparent_recovery_failed";
  }
  if (
    report?.frame?.tiled &&
    report?.transparentRecovery?.attempted !== true
  ) {
    return "node2:transparent_background_unsupported";
  }
  return null;
}

export function summarizeNode2TransparentTileRecovery(failedTiles, totalTiles) {
  const failed = Math.max(0, Math.trunc(Number(failedTiles) || 0));
  const total = Math.max(0, Math.trunc(Number(totalTiles) || 0));
  const normalizedFailed = Math.min(failed, total);
  return {
    attempted: true,
    ok: normalizedFailed === 0,
    fallback: normalizedFailed === 0 ? null : "black-frame",
    failedTiles: normalizedFailed,
    totalTiles: total,
  };
}

export async function captureTwoFrameTransparentMatte({
  colorA,
  colorB,
  setColor,
  seedBaseline,
  captureChanged,
  cropCanvas = (canvas) => canvas,
  recover,
  isTransparent,
} = {}) {
  const resources = new Set();

  await setColor(colorB);
  const baseline = await seedBaseline();
  const baselineSignature = String(baseline?.signature || "");
  if (!baselineSignature) {
    throw new Error("Node 2.0 transparent capture could not establish a baseline frame.");
  }

  await setColor(colorA);
  const frameA = await captureChanged({ strictChangedFrame: true });
  addResource(resources, frameA?.canvas);
  const signatureA = getFrameSignature(frameA);
  if (!signatureA || signatureA === baselineSignature || frameA?.frame?.unchangedFrame) {
    throw new Error("Node 2.0 transparent capture did not receive a fresh black frame.");
  }

  const matteA = addResource(resources, cropCanvas(frameA.canvas));

  let frameB = null;
  let matteB = null;
  let recoveryFailure = null;
  try {
    await setColor(colorB);
    frameB = await captureChanged({ strictChangedFrame: true });
    addResource(resources, frameB?.canvas);
    const signatureB = getFrameSignature(frameB);
    if (!signatureB || signatureB === signatureA || frameB?.frame?.unchangedFrame) {
      throw new Error("Node 2.0 transparent capture did not receive a fresh white frame.");
    }
    matteB = addResource(resources, cropCanvas(frameB.canvas));
  } catch (error) {
    recoveryFailure = error;
  }

  if (!recoveryFailure && matteA && matteB) {
    const recovered = addResource(resources, recover(matteA, matteB, colorA, colorB));
    if (recovered && isTransparent(recovered)) {
      return {
        canvas: recovered,
        frameA,
        frameB,
        resources: [...resources],
        transparentRecovery: {
          attempted: true,
          ok: true,
          fallback: null,
        },
      };
    }
    recoveryFailure = new Error(
      recovered
        ? "Node 2.0 transparent recovery produced an opaque image."
        : "Node 2.0 transparent recovery failed."
    );
  }

  return {
    canvas: matteA,
    frameA,
    frameB,
    resources: [...resources],
    transparentRecovery: {
      attempted: true,
      ok: false,
      fallback: "black-frame",
      error: recoveryFailure?.message || "unknown recovery failure",
    },
  };
}
