import { describe, expect, test } from "bun:test";
import { BadRequestError, PayloadTooLargeError } from "@getstrata/core/errors/http";
import {
  parseMultipartUpload,
  sanitizeUploadFileName,
  validateUploadFile,
} from "@getstrata/core/http/parseMultipartUpload";
import { isAllowedMimeType, resolveMaxUploadBytes } from "@getstrata/core/http/uploads";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("upload helpers", () => {
  test("published @getstrata/core/http/uploads resolves MIME and size helpers", async () => {
    const pkg = (await Bun.file("packages/strata-core/package.json").json()) as {
      exports: Record<string, unknown>;
    };
    expect(pkg.exports["./http/uploads"]).toBeDefined();
    expect(isAllowedMimeType("image/jpeg")).toBe(true);
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(typeof resolveMaxUploadBytes).toBe("function");
  });

  test("sanitizeUploadFileName strips path segments and unsafe characters", () => {
    expect(sanitizeUploadFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeUploadFileName("report final.pdf")).toBe("report final.pdf");
  });

  test("resolveMaxUploadBytes falls back to five megabytes", () => {
    const previous = process.env.MAX_UPLOAD_BYTES;
    delete process.env.MAX_UPLOAD_BYTES;
    delete process.env.MAX_REQUEST_BODY_BYTES;

    expect(resolveMaxUploadBytes()).toBe(5 * 1024 * 1024);

    if (previous === undefined) {
      delete process.env.MAX_UPLOAD_BYTES;
    } else {
      restoreEnvVar("MAX_UPLOAD_BYTES", previous);
    }
  });

  test("isAllowedMimeType accepts common upload types", () => {
    expect(isAllowedMimeType("image/png")).toBe(true);
    expect(isAllowedMimeType("application/x-msdownload")).toBe(false);
  });

  test("isAllowedMimeType rejects an undeclared type unless explicitly opted in", () => {
    const previous = process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    process.env.UPLOAD_ALLOW_UNKNOWN_MIME = undefined as unknown as string;
    delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;

    expect(isAllowedMimeType("application/octet-stream")).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);

    process.env.UPLOAD_ALLOW_UNKNOWN_MIME = "true";
    expect(isAllowedMimeType("application/octet-stream")).toBe(true);

    if (previous === undefined) {
      delete process.env.UPLOAD_ALLOW_UNKNOWN_MIME;
    } else {
      process.env.UPLOAD_ALLOW_UNKNOWN_MIME = previous;
    }
  });

  test("validateUploadFile applies the same MIME and size guards as parseMultipartUpload", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", {
      type: "image/jpeg",
    });
    const parsed = await validateUploadFile(jpeg, "image");
    expect(parsed.fileName).toBe("photo.jpg");
    expect(parsed.mimeType).toBe("image/jpeg");
    expect(parsed.size).toBe(3);

    const exe = new File([new Uint8Array([1, 2, 3])], "payload.exe", {
      type: "application/x-msdownload",
    });
    await expect(validateUploadFile(exe)).rejects.toThrow(BadRequestError);

    const empty = new File([], "empty.png", { type: "image/png" });
    await expect(validateUploadFile(empty)).rejects.toThrow("Uploaded file is empty.");
  });

  test("validateUploadFile rejects files over MAX_UPLOAD_BYTES", async () => {
    const previous = process.env.MAX_UPLOAD_BYTES;
    process.env.MAX_UPLOAD_BYTES = "4";

    try {
      const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "photo.jpg", {
        type: "image/jpeg",
      });
      await expect(validateUploadFile(file)).rejects.toThrow(PayloadTooLargeError);
    } finally {
      if (previous === undefined) {
        delete process.env.MAX_UPLOAD_BYTES;
      } else {
        restoreEnvVar("MAX_UPLOAD_BYTES", previous);
      }
    }
  });

  test("parseMultipartUpload delegates field Files through validateUploadFile", async () => {
    const body = new FormData();
    body.set("file", new File([new Uint8Array([1, 2, 3])], "note.txt", { type: "text/plain" }));
    const request = new Request("http://strata.test/upload", { method: "POST", body });
    const parsed = await parseMultipartUpload(request);
    expect(parsed.fileName).toBe("note.txt");
    expect(parsed.mimeType).toBe("text/plain");
  });
});
