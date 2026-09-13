const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4096 * 4096;

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has(normalizeMimeType(mimeType));
}

function parseThumbnailWidth(
  raw: string | null | undefined,
  options: { defaultWidth?: number; minWidth?: number; maxWidth?: number } = {},
): number {
  const defaultWidth = options.defaultWidth ?? 200;
  const minWidth = options.minWidth ?? 16;
  const maxWidth = options.maxWidth ?? 800;

  if (!raw?.trim()) {
    return defaultWidth;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed)) {
    return defaultWidth;
  }

  return Math.min(maxWidth, Math.max(minWidth, parsed));
}

async function resizeImageContents(
  contents: Uint8Array,
  width: number,
  mimeType: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  if (contents.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("Image exceeds the maximum allowed size.");
  }

  const normalized = normalizeMimeType(mimeType);
  const source = new Bun.Image(contents);
  const metadata = await source.metadata();
  const pixels = Number(metadata.width) * Number(metadata.height);

  if (pixels > MAX_IMAGE_PIXELS) {
    throw new Error("Image exceeds the maximum allowed dimensions.");
  }

  const pipeline = source.resize(width);

  if (normalized === "image/png") {
    return { body: await pipeline.png().bytes(), contentType: "image/png" };
  }

  if (normalized === "image/webp") {
    return { body: await pipeline.webp().bytes(), contentType: "image/webp" };
  }

  return { body: await pipeline.jpeg().bytes(), contentType: "image/jpeg" };
}

export {
  IMAGE_MIME_TYPES,
  isImageMimeType,
  normalizeMimeType,
  parseThumbnailWidth,
  resizeImageContents,
};
