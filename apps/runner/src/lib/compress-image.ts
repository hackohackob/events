/**
 * Client-side photo compression: downscale to a sane max dimension and
 * re-encode as JPEG before upload. Phone cameras produce 5–15 MB originals,
 * which is miserable over race-course mobile data — ~1600px JPEG keeps every
 * detail a medic needs at a tenth of the size.
 *
 * Best-effort by design: anything that fails to decode (odd formats, HEIC on
 * browsers without support) falls back to the original blob.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
/** Don't bother re-encoding files already smaller than this. */
const SKIP_BELOW_BYTES = 300 * 1024;

async function decode(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("image decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function compressImage(input: Blob): Promise<Blob> {
  if (!input.type.startsWith("image/")) return input;
  if (input.size < SKIP_BELOW_BYTES) return input;

  try {
    const image = await decode(input);
    const width = "naturalWidth" in image ? image.naturalWidth : image.width;
    const height = "naturalHeight" in image ? image.naturalHeight : image.height;
    if (!width || !height) return input;

    const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return input;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    if ("close" in image) image.close();

    const output = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    // Keep the original if encoding failed or somehow grew the file.
    if (!output || output.size >= input.size) return input;
    return output;
  } catch {
    return input;
  }
}
