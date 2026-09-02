export function runSingleFlight(sharedState, key, operation) {
  if (!sharedState || typeof operation !== "function") {
    return Promise.reject(new TypeError("Single-flight state and operation are required."));
  }
  if (sharedState[key]) {
    return sharedState[key];
  }
  let pending;
  try {
    pending = Promise.resolve(operation());
  } catch (error) {
    pending = Promise.reject(error);
  }
  const shared = pending.finally(() => {
    if (sharedState[key] === shared) {
      delete sharedState[key];
    }
  });
  sharedState[key] = shared;
  return shared;
}
