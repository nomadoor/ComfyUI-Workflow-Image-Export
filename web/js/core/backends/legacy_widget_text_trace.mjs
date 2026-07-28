function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n");
}

function matchesTargetText(drawnText, targetText) {
  const drawn = normalizeText(drawnText);
  const target = normalizeText(targetText);
  if (!drawn || !target) return false;
  if (drawn === target) return true;
  if (target.split("\n").includes(drawn)) return true;
  return drawn.length >= 4 && target.includes(drawn);
}

function readTransform(ctx) {
  try {
    const transform = ctx?.getTransform?.();
    if (!transform) return null;
    return {
      a: transform.a,
      b: transform.b,
      c: transform.c,
      d: transform.d,
      e: transform.e,
      f: transform.f,
    };
  } catch (_) {
    return null;
  }
}

export function createWidgetTextTrace({
  ctx,
  plan,
  debugLog,
  maxCalls = 100,
} = {}) {
  const targets = (Array.isArray(plan) ? plan : [])
    .filter((entry) => entry?.key && normalizeText(entry.text))
    .map((entry) => ({
      key: entry.key,
      text: normalizeText(entry.text),
    }));
  const originals = new Map();
  const calls = [];
  let stage = "unassigned";

  if (!ctx || typeof debugLog !== "function" || targets.length === 0) {
    return {
      setStage() {},
      restore() {},
      summary() {
        return { targets: targets.length, matchedCalls: 0, truncated: false, byStage: {} };
      },
    };
  }

  for (const method of ["fillText", "strokeText"]) {
    if (typeof ctx[method] !== "function") continue;
    const original = ctx[method];
    originals.set(method, original);
    ctx[method] = function tracedWidgetText(text, x, y, ...rest) {
      const matchingKeys = targets
        .filter((target) => matchesTargetText(text, target.text))
        .map((target) => target.key);
      if (matchingKeys.length && calls.length < maxCalls) {
        const call = {
          stage,
          method,
          matchingKeys,
          text: normalizeText(text),
          x: Number(x),
          y: Number(y),
          font: String(this?.font || ""),
          fillStyle: String(this?.fillStyle || ""),
          strokeStyle: String(this?.strokeStyle || ""),
          transform: readTransform(this),
          stack: new Error("CWIE widget text draw trace").stack,
        };
        calls.push(call);
        debugLog("widget.text.trace", call);
      }
      return original.call(this, text, x, y, ...rest);
    };
  }

  return {
    setStage(nextStage) {
      stage = String(nextStage || "unassigned");
    },
    restore() {
      for (const [method, original] of originals) {
        try {
          ctx[method] = original;
        } catch (_) {}
      }
    },
    summary() {
      const byStage = {};
      for (const call of calls) {
        byStage[call.stage] = (byStage[call.stage] || 0) + 1;
      }
      return {
        targets: targets.length,
        matchedCalls: calls.length,
        truncated: calls.length >= maxCalls,
        byStage,
      };
    },
  };
}

export { matchesTargetText };
