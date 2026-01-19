import { findGraphCanvas } from "./detect.js";

function createFallbackCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#1f1f1f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e5e5e5";
    ctx.font = "14px sans-serif";
    ctx.fillText("Workflow export placeholder", 16, 90);
  }
  return canvas;
}

export async function capturePlaceholderPng() {
  const graphCanvas = findGraphCanvas();
  const sourceCanvas = graphCanvas || createFallbackCanvas();

  try {
    return sourceCanvas.toDataURL("image/png");
  } catch (error) {
    const fallback = createFallbackCanvas();
    return fallback.toDataURL("image/png");
  }
}
