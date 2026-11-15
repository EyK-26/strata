const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4096 * 4096;
const MAX_IMAGE_DIMENSION = 4096;
const CONTENT_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

type ImageOutputFormat = "jpeg" | "png" | "webp";
interface ImageTransformOptions {
  readonly width?: number;
  readonly height?: number;
  /** With both dimensions, preserve aspect ratio inside the box or stretch to fill it. */
  readonly fit?: "inside" | "fill";
  readonly format?: ImageOutputFormat;
  /** JPEG/WebP quality, an integer from 1 through 100. PNG uses lossless encoding. */
  readonly quality?: number;
  /** Defaults to true. */
  readonly withoutEnlargement?: boolean;
  /** Optional assertion about input bytes; never selects the output format. */
  readonly contentType?: string;
}
interface ImageTransformResult {
  readonly body: Uint8Array;
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  readonly width: number;
  readonly height: number;
}

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

  if (!raw?.trim()) return defaultWidth;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) return defaultWidth;
  return Math.min(maxWidth, Math.max(minWidth, parsed));
}

function dimension(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > MAX_IMAGE_DIMENSION)
    throw new TypeError(`Image dimensions must be integers from 1 through ${MAX_IMAGE_DIMENSION}.`);
}
function transformOptions(input: ImageTransformOptions): ImageTransformOptions {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  )
    throw new TypeError("Invalid image transform options.");
  const values: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      typeof key !== "string" ||
      ![
        "width",
        "height",
        "fit",
        "format",
        "quality",
        "withoutEnlargement",
        "contentType",
      ].includes(key) ||
      !descriptor ||
      !("value" in descriptor)
    )
      throw new TypeError("Invalid image transform options.");
    values[key] = descriptor.value;
  }
  if (values.width !== undefined) dimension(values.width);
  if (values.height !== undefined) dimension(values.height);
  if (values.fit !== undefined && values.fit !== "inside" && values.fit !== "fill")
    throw new TypeError("Image fit must be inside or fill.");
  if (values.format !== undefined && !["jpeg", "png", "webp"].includes(values.format as string))
    throw new TypeError("Image output format must be jpeg, png, or webp.");
  if (
    values.quality !== undefined &&
    (!Number.isInteger(values.quality) ||
      (values.quality as number) < 1 ||
      (values.quality as number) > 100)
  )
    throw new TypeError("Image quality must be an integer from 1 through 100.");
  if (values.withoutEnlargement !== undefined && typeof values.withoutEnlargement !== "boolean")
    throw new TypeError("Image withoutEnlargement must be a boolean.");
  if (values.contentType !== undefined) {
    if (typeof values.contentType !== "string" || !isImageMimeType(values.contentType))
      throw new TypeError("Unsupported image content type.");
    values.contentType = normalizeMimeType(values.contentType);
  }
  return values as ImageTransformOptions;
}
function imageFailure(error: unknown): Error {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ERR_IMAGE_TOO_MANY_PIXELS"
  )
    return new Error("Image exceeds the maximum allowed dimensions.", { cause: error });
  return new Error("Invalid or unsupported image contents.", { cause: error });
}

/** Native Bun pipeline. Limits apply before decoding and to the returned encoded image. */
async function transformImageContents(
  contents: Uint8Array,
  options: ImageTransformOptions = {},
): Promise<ImageTransformResult> {
  const settings = transformOptions(options);
  if (!(contents instanceof Uint8Array) || contents.byteLength === 0)
    throw new TypeError("Image contents must be a nonempty Uint8Array.");
  if (contents.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Image exceeds the maximum allowed size.");
  // Own the bounded bytes so caller mutation cannot change input after admission.
  const source = new Bun.Image(contents.slice(), { maxPixels: MAX_IMAGE_PIXELS });
  let metadata: Bun.Image.Metadata;
  try {
    metadata = await source.metadata();
  } catch (error) {
    throw imageFailure(error);
  }
  if (!(metadata.format in CONTENT_TYPES)) throw new TypeError("Unsupported image input format.");
  const detected = metadata.format as keyof typeof CONTENT_TYPES;
  if (settings.contentType !== undefined && settings.contentType !== CONTENT_TYPES[detected])
    throw new TypeError("Image content type does not match its contents.");
  const format = settings.format ?? (detected === "gif" ? "jpeg" : detected);
  if (format === "png" && settings.quality !== undefined)
    throw new TypeError("Image quality is supported only for jpeg and webp output.");
  if (settings.width !== undefined || settings.height !== undefined) {
    const width =
      settings.width ??
      Math.max(1, Math.round((metadata.width * (settings.height as number)) / metadata.height));
    const height =
      settings.height ?? Math.max(1, Math.round((metadata.height * width) / metadata.width));
    dimension(width);
    dimension(height);
    source.resize(width, height, {
      fit: settings.fit ?? "inside",
      withoutEnlargement: settings.withoutEnlargement ?? true,
    });
  } else {
    dimension(metadata.width);
    dimension(metadata.height);
  }
  if (format === "png") source.png();
  else if (format === "webp") source.webp({ quality: settings.quality });
  else source.jpeg({ quality: settings.quality });
  let body: Uint8Array;
  try {
    body = await source.bytes();
  } catch (error) {
    throw imageFailure(error);
  }
  if (body.byteLength > MAX_IMAGE_BYTES)
    throw new Error("Image output exceeds the maximum allowed size.");
  return { body, contentType: CONTENT_TYPES[format], width: source.width, height: source.height };
}

/** Compatibility helper: mimeType selects output; width-only resizing retains upscaling. */
async function resizeImageContents(
  contents: Uint8Array,
  width: number,
  mimeType: string,
): Promise<{ body: Uint8Array; contentType: string }> {
  const normalized = normalizeMimeType(mimeType);
  return transformImageContents(contents, {
    width,
    format: normalized === "image/png" ? "png" : normalized === "image/webp" ? "webp" : "jpeg",
    withoutEnlargement: false,
  });
}

export type { ImageOutputFormat, ImageTransformOptions, ImageTransformResult };
export {
  IMAGE_MIME_TYPES,
  isImageMimeType,
  normalizeMimeType,
  parseThumbnailWidth,
  resizeImageContents,
  transformImageContents,
};
