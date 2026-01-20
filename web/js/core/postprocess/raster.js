function toBlobAsync(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to create blob."));
        return;
      }
      resolve(blob);
    }, type);
  });
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    image.src = url;
  });
}

function resolveBackgroundMode(options) {
  const mode = options?.background || "ui";
  return mode;
}

function resolveBackgroundColor(options, root) {
  if (options?.background === "transparent") {
    return null;
  }
  if (options?.background === "solid") {
    return options?.solidColor || "#1f1f1f";
  }
  const target = root || document.body;
  const style = target ? window.getComputedStyle(target) : null;
  return style?.backgroundColor || "#1f1f1f";
}

export async function applyBackground(result, options = {}) {
  if (result.type !== "raster") {
    return result;
  }

  const mode = resolveBackgroundMode(options);
  if (mode === "transparent") {
    return result;
  }

  const image = await blobToImage(result.blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return result;
  }

  const color = resolveBackgroundColor(options);
  ctx.fillStyle = color || "#1f1f1f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);

  const blob = await toBlobAsync(canvas, result.mime);
  return {
    ...result,
    blob,
  };
}

export async function downscaleIfNeeded(result, options = {}) {
  if (result.type !== "raster") {
    return result;
  }
  const maxLongEdge = Number(options.maxLongEdge) || 0;
  if (!maxLongEdge) {
    return result;
  }

  const image = await blobToImage(result.blob);
  const longEdge = Math.max(image.width, image.height);
  if (longEdge <= maxLongEdge) {
    return result;
  }

  const scale = maxLongEdge / longEdge;
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return result;
  }
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
  const blob = await toBlobAsync(canvas, result.mime);
  return {
    ...result,
    blob,
    width: targetWidth,
    height: targetHeight,
  };
}
