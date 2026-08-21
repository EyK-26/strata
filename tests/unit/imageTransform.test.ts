import { describe, expect, test } from "bun:test";
import {
  isImageMimeType,
  parseThumbnailWidth,
  resizeImageContents,
} from "@getstrata/core/media/imageTransform";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

describe("imageTransform", () => {
  test("isImageMimeType recognizes supported image types", () => {
    expect(isImageMimeType("image/png")).toBe(true);
    expect(isImageMimeType("image/jpeg; charset=binary")).toBe(true);
    expect(isImageMimeType("text/plain")).toBe(false);
  });

  test("parseThumbnailWidth clamps and defaults", () => {
    expect(parseThumbnailWidth(undefined)).toBe(200);
    expect(parseThumbnailWidth("abc")).toBe(200);
    expect(parseThumbnailWidth("12")).toBe(16);
    expect(parseThumbnailWidth("9999")).toBe(800);
    expect(parseThumbnailWidth("320")).toBe(320);
  });

  test("resizeImageContents returns png bytes for png input", async () => {
    const source = decodeBase64(PNG_BASE64);
    const result = await resizeImageContents(source, 64, "image/png");

    expect(result.contentType).toBe("image/png");
    expect(result.body.byteLength).toBeGreaterThan(0);
  });

  test("resizeImageContents returns webp bytes for webp input", async () => {
    const source = decodeBase64(PNG_BASE64);
    const webpSource = await new Bun.Image(source).webp().bytes();
    const result = await resizeImageContents(webpSource, 64, "image/webp");

    expect(result.contentType).toBe("image/webp");
    expect(result.body.byteLength).toBeGreaterThan(0);
  });

  test("resizeImageContents returns jpeg bytes for other image types", async () => {
    const source = decodeBase64(PNG_BASE64);
    const result = await resizeImageContents(source, 64, "image/jpeg");

    expect(result.contentType).toBe("image/jpeg");
    expect(result.body.byteLength).toBeGreaterThan(0);
  });
});
