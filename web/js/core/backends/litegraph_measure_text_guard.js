export function createLiteGraphMeasureTextGuard(LGraphCanvasRef) {
  const states = [];
  let current = LGraphCanvasRef;
  while (
    current &&
    current !== Function.prototype &&
    current !== Object.prototype
  ) {
    const hadOwn = Object.prototype.hasOwnProperty.call(current, "_measureText");
    states.push({
      owner: current,
      hadOwn,
      descriptor: hadOwn
        ? Object.getOwnPropertyDescriptor(current, "_measureText")
        : null,
    });
    current = Object.getPrototypeOf(current);
  }
  let restored = false;

  return {
    restore() {
      if (restored) return;
      restored = true;
      for (const state of states) {
        try {
          if (state.hadOwn && state.descriptor) {
            Object.defineProperty(state.owner, "_measureText", state.descriptor);
          } else {
            delete state.owner._measureText;
          }
        } catch (_) {}
      }
    },
  };
}
