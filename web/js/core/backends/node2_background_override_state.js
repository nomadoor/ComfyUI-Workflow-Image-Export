export function createBackgroundOverrideState({
  saveOriginal,
  writeColor,
  restoreOriginal,
} = {}) {
  let originalSaved = false;

  const ensureOriginalSaved = async () => {
    if (originalSaved) return;
    await saveOriginal?.();
    originalSaved = true;
  };

  return {
    async apply(color) {
      await ensureOriginalSaved();
      await writeColor?.(color);
    },
    async setColor(color) {
      if (!originalSaved) {
        throw new Error("Node 2.0 background override must be applied before changing color.");
      }
      await writeColor?.(color);
    },
    async restore() {
      if (!originalSaved) return;
      try {
        await restoreOriginal?.();
      } finally {
        originalSaved = false;
      }
    },
  };
}
