function getFrameSignature(frame) {
  return String(frame?.frame?.signature || "");
}

function addResource(resources, canvas) {
  if (canvas) resources.add(canvas);
  return canvas;
}

export function getNode2TransparentWarning(options = {}, report = null) {
  if (options.background !== "transparent") return null;
  if (report?.transparentRecovery?.attempted !== true) {
    return "node2:transparent_background_unsupported";
  }
  if (
    report.transparentRecovery.ok !== true
  ) {
    return "node2:transparent_recovery_failed";
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

export function validateNode2TransparentTileOutput(recovery, outputIsTransparent) {
  if (!recovery?.attempted || outputIsTransparent) {
    return recovery;
  }
  return {
    ...recovery,
    ok: false,
    outputTransparent: false,
    error: recovery.error ||
      "Node 2.0 transparent tiled recovery produced an opaque output.",
  };
}

function assertFreshFrame(frame, previousSignature, label) {
  const signature = getFrameSignature(frame);
  if (
    !signature ||
    (previousSignature && signature === previousSignature) ||
    frame?.frame?.unchangedFrame
  ) {
    throw new Error(`Node 2.0 transparent capture did not receive a fresh ${label} frame.`);
  }
  return signature;
}

export async function captureTwoFrameTransparentMatte({
  colorA,
  colorB,
  setColor,
  seedBaseline,
  captureCurrent,
  captureChanged,
  cropCanvas = (canvas) => canvas,
  recover,
  isTransparent,
  startColor = null,
} = {}) {
  const resources = new Set();
  let frameA = null;
  let frameB = null;
  let endColor = colorB;
  let recoveryFailure = null;

  if (startColor != null) {
    if (startColor !== colorA && startColor !== colorB) {
      throw new Error("Node 2.0 transparent capture startColor must match a matte color.");
    }
    const firstColor = startColor;
    const secondColor = firstColor === colorA ? colorB : colorA;
    endColor = firstColor;
    const firstFrame = await (captureCurrent || captureChanged)({
      strictChangedFrame: false,
      cameraArrivalFrame: true,
    });
    addResource(resources, firstFrame?.canvas);
    const firstSignature = getFrameSignature(firstFrame);
    if (!firstSignature || !firstFrame?.canvas) {
      throw new Error("Node 2.0 transparent capture did not receive a camera-arrival frame.");
    }
    if (firstColor === colorA) frameA = firstFrame;
    else frameB = firstFrame;

    try {
      await setColor(secondColor);
      endColor = secondColor;
      const secondFrame = await captureChanged({ strictChangedFrame: true });
      addResource(resources, secondFrame?.canvas);
      assertFreshFrame(secondFrame, firstSignature, secondColor);
      if (secondColor === colorA) frameA = secondFrame;
      else frameB = secondFrame;
    } catch (error) {
      recoveryFailure = error;
    }
  } else {
    await setColor(colorB);
    const baseline = await seedBaseline();
    const baselineSignature = String(baseline?.signature || "");
    if (!baselineSignature) {
      throw new Error("Node 2.0 transparent capture could not establish a baseline frame.");
    }

    await setColor(colorA);
    frameA = await captureChanged({ strictChangedFrame: true });
    addResource(resources, frameA?.canvas);
    const signatureA = assertFreshFrame(frameA, baselineSignature, "black");

    try {
      await setColor(colorB);
      frameB = await captureChanged({ strictChangedFrame: true });
      addResource(resources, frameB?.canvas);
      assertFreshFrame(frameB, signatureA, "white");
    } catch (error) {
      recoveryFailure = error;
    }
  }

  const matteA = frameA
    ? addResource(resources, cropCanvas(frameA.canvas))
    : null;
  const matteB = frameB
    ? addResource(resources, cropCanvas(frameB.canvas))
    : null;

  if (!recoveryFailure && matteA && matteB) {
    const recovered = addResource(resources, recover(matteA, matteB, colorA, colorB));
    if (recovered && isTransparent(recovered)) {
      return {
        canvas: recovered,
        frameA,
        frameB,
        endColor,
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
  } else if (!recoveryFailure) {
    recoveryFailure = new Error("Node 2.0 transparent capture did not produce both matte frames.");
  }

  return {
    canvas: matteA,
    frameA,
    frameB,
    endColor,
    resources: [...resources],
    transparentRecovery: {
      attempted: true,
      ok: false,
      fallback: matteA ? "black-frame" : null,
      error: recoveryFailure?.message || "unknown recovery failure",
    },
  };
}
