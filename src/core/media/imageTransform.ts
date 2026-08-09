const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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
  const normalized = normalizeMimeType(mimeType);
  const pipeline = new Bun.Image(contents).resize(width);

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
