import { AVATAR_SIZE } from "./constants.js";

export async function stripImageMetadata(file) {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
  const outputMime = allowedMimes.includes(file.type) ? file.type : "image/png";
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, 0.92));
    if (!blob) throw new Error("Image conversion failed");
    return { buffer: await blob.arrayBuffer(), mime: outputMime };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

export async function prepareAvatarImage(file) {
  const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
  const outputMime = allowedMimes.includes(file.type) ? file.type : "image/png";
  const bitmap = await createImageBitmap(file);
  try {
    const size = Math.min(bitmap.width, bitmap.height);
    const sx = Math.floor((bitmap.width - size) / 2);
    const sy = Math.floor((bitmap.height - size) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, outputMime, 0.92));
    if (!blob) throw new Error("Image conversion failed");
    return { buffer: await blob.arrayBuffer(), mime: outputMime };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
