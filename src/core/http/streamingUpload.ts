import { Buffer } from "node:buffer";
import { BadRequestError, PayloadTooLargeError } from "@getstrata/core/errors/http";
import type { StreamingStorage } from "../storage/storage";
import { assertUploadContentType, uploadTextDecoder, validateUploadText } from "./uploadContent";
import { DEFAULT_UPLOAD_POLICY, isAllowedMimeType, type UploadPolicy } from "./uploads";

const HEADER_LIMIT = 16 * 1024;
const ENVELOPE_LIMIT = 64 * 1024;
const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

/** One file, one consumption. Storage stays an explicit consumer capability. */
class UploadedFile {
  private consumed = false;

  constructor(
    readonly fileName: string,
    readonly mimeType: string,
    private readonly contents: ReadableStream<Uint8Array>,
  ) {}

  stream(): ReadableStream<Uint8Array> {
    if (this.consumed) throw new TypeError("Uploaded file has already been consumed.");
    this.consumed = true;
    return this.contents;
  }

  /** Explicit buffering for bounded operations such as image decoding. */
  bytes(): Promise<Uint8Array> {
    return new Response(this.stream()).bytes();
  }

  /** Discard an unneeded upload and cancel its request source. */
  async discard(): Promise<void> {
    await this.stream().cancel();
  }

  /** Generated keys avoid overwriting an existing object during validation/cleanup. */
  async store(
    storage: Pick<StreamingStorage, "writeStream" | "delete">,
    directory = "uploads",
  ): Promise<string> {
    if (
      typeof directory !== "string" ||
      /[\\\0]/.test(directory) ||
      (directory !== "" &&
        directory.split("/").some((part) => !part || part === "." || part === ".."))
    )
      throw new TypeError("Upload directory must be a relative path without traversal.");
    const key = `${directory ? `${directory}/` : ""}${crypto.randomUUID()}`;
    const reader = this.stream().getReader();
    let completed = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              completed = true;
              controller.close();
            } else controller.enqueue(next.value);
          } catch (error) {
            controller.error(error);
          }
        },
        cancel: (reason) => reader.cancel(reason),
      },
      { highWaterMark: 0 },
    );
    try {
      await storage.writeStream(key, stream);
      if (!completed) throw new TypeError("Storage driver did not consume the upload.");
      return key;
    } catch (error) {
      // Own the upstream reader even when a failing driver retains its downstream lock.
      await reader.cancel(error).catch(() => {});
      try {
        await storage.delete(key);
      } catch (cleanup) {
        throw new AggregateError(
          [error, cleanup],
          "Upload failed and partial-object cleanup failed.",
        );
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}

/** Incremental single-file multipart framing; buffers only a chunk plus boundary/header lookahead. */
class MultipartReader {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;
  private closed = false;
  private total = 0;
  private parts = 0;
  finished = false;
  private readonly delimiter: Buffer;

  constructor(
    private readonly reader: Pick<
      ReadableStreamDefaultReader<Uint8Array>,
      "read" | "cancel" | "releaseLock"
    >,
    private readonly boundary: string,
    private readonly maxBytes: number,
  ) {
    this.delimiter = Buffer.from(`\r\n--${boundary}`);
  }

  private async fill(): Promise<void> {
    const next = await this.reader.read();
    if (next.done) {
      this.ended = true;
      return;
    }
    this.total += next.value.byteLength;
    if (this.total > this.maxBytes)
      throw new PayloadTooLargeError("Multipart request exceeds its byte limit.");
    const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
  }

  private async until(delimiter: Buffer, limit: number): Promise<Buffer> {
    while (true) {
      const index = this.buffer.indexOf(delimiter);
      if (index >= 0 && index <= limit) {
        const result = this.buffer.subarray(0, index);
        this.buffer = this.buffer.subarray(index + delimiter.length);
        return result;
      }
      if (index > limit || this.buffer.length > limit + delimiter.length)
        throw new BadRequestError("Multipart header exceeds its limit.");
      if (this.ended) throw new BadRequestError("Truncated multipart request.");
      await this.fill();
    }
  }

  async start(): Promise<void> {
    const opening = await this.until(CRLF, 74);
    if (opening.toString() !== `--${this.boundary}`)
      throw new BadRequestError("Invalid multipart opening boundary.");
  }

  async headers(): Promise<{ name: string; fileName?: string; mimeType: string }> {
    if (++this.parts > 32) throw new BadRequestError("Too many multipart fields.");
    const raw = await this.until(HEADER_END, HEADER_LIMIT);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      throw new BadRequestError("Invalid multipart headers.");
    }
    const headers = new Map<string, string>();
    for (const line of text.split("\r\n")) {
      const match = /^([!#$%&'*+.^_`|~\w-]+):[ \t]*([^\r\n\0]*)$/.exec(line);
      if (!match) throw new BadRequestError("Invalid multipart header.");
      const key = (match[1] as string).toLowerCase();
      if (headers.has(key)) throw new BadRequestError("Duplicate multipart header.");
      headers.set(key, (match[2] as string).trim());
    }
    if (headers.has("content-transfer-encoding"))
      throw new BadRequestError("Encoded multipart parts are unsupported.");
    const disposition = headers.get("content-disposition") ?? "";
    if (!/^form-data\s*(;|$)/i.test(disposition))
      throw new BadRequestError("Expected a form-data disposition.");
    const params = new Map<string, string>();
    let rest = disposition.replace(/^form-data\s*/i, "");
    while (rest) {
      const match =
        /^;\s*([\w-]+)\s*=\s*(?:"((?:[^"\\\r\n]|\\["\\])*)"|([!#$%&'*+.^_`|~\w-]+))\s*/.exec(rest);
      if (!match) throw new BadRequestError("Invalid multipart disposition parameters.");
      const key = (match[1] as string).toLowerCase();
      if (params.has(key)) throw new BadRequestError("Duplicate multipart disposition parameter.");
      params.set(key, ((match[2] ?? match[3]) as string).replace(/\\(["\\])/g, "$1"));
      rest = rest.slice(match[0].length);
    }
    const name = params.get("name");
    if (!name) throw new BadRequestError("Multipart field name is required.");
    return {
      name,
      fileName: params.get("filename"),
      mimeType:
        (headers.get("content-type") ?? "application/octet-stream")
          .split(";")[0]
          ?.trim()
          .toLowerCase() ?? "",
    };
  }

  async *body(): AsyncGenerator<Uint8Array> {
    while (true) {
      const index = this.buffer.indexOf(this.delimiter);
      if (index >= 0) {
        const suffix = index + this.delimiter.length;
        // Include the final boundary's optional CRLF in lookahead before recognizing it.
        while (!this.ended && this.buffer.length < suffix + 4) await this.fill();
        const next = this.buffer.subarray(suffix, suffix + 2).toString();
        const final =
          next === "--" &&
          ((this.buffer.length === suffix + 2 && this.ended) ||
            this.buffer.subarray(suffix + 2, suffix + 4).equals(CRLF));
        if (next === "\r\n" || final) {
          const body = this.buffer.subarray(0, index);
          this.buffer = this.buffer.subarray(suffix + 2);
          this.finished = final;
          if (body.length) yield body;
          return;
        }
        // A boundary-like byte sequence with a different suffix is file content.
        const body = this.buffer.subarray(0, index + 2);
        this.buffer = this.buffer.subarray(index + 2);
        yield body;
      } else {
        const available = this.buffer.length - this.delimiter.length + 1;
        if (available > 0) {
          const body = this.buffer.subarray(0, available);
          this.buffer = this.buffer.subarray(available);
          yield body;
        } else {
          if (this.ended) throw new BadRequestError("Truncated multipart body.");
          await this.fill();
        }
      }
    }
  }

  async finish(): Promise<void> {
    if (this.buffer.length && !this.buffer.equals(CRLF))
      throw new BadRequestError("Unexpected data after multipart closing boundary.");
    this.buffer = Buffer.alloc(0);
    while (!this.ended) {
      await this.fill();
      if (this.buffer.length)
        throw new BadRequestError("Unexpected data after multipart closing boundary.");
    }
  }

  async close(reason?: unknown): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (!this.ended) await this.reader.cancel(reason);
    } finally {
      this.reader.releaseLock();
    }
  }
}

/** Single file plus bounded text fields. Validation completes when its stream completes. */
async function parseMultipartUploadStream(
  request: Request,
  fieldName = "file",
  policy: UploadPolicy = DEFAULT_UPLOAD_POLICY,
): Promise<UploadedFile> {
  if (
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes <= 0 ||
    policy.maxBytes > Number.MAX_SAFE_INTEGER - ENVELOPE_LIMIT
  )
    throw new RangeError("Upload limit must be a positive safe integer.");
  const maxBytes = policy.maxBytes;
  const allowUnknownMime = policy.allowUnknownMime;
  if (typeof allowUnknownMime !== "boolean")
    throw new TypeError("Upload allowUnknownMime must be a boolean.");
  const contentType = request.headers.get("content-type") ?? "";
  const match =
    /^multipart\/form-data\s*;\s*boundary=(?:"([\w'()+,\-./:=? ]{1,70})"|([\w'()+,\-./:=?]{1,70}))\s*$/i.exec(
      contentType,
    );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.endsWith(" ") || !request.body)
    throw new BadRequestError("Expected multipart form data with a valid boundary and body.");
  const parser = new MultipartReader(request.body.getReader(), boundary, maxBytes + ENVELOPE_LIMIT);
  let metadataBytes = 0;
  async function skipField(): Promise<void> {
    for await (const chunk of parser.body()) {
      metadataBytes += chunk.byteLength;
      if (metadataBytes > ENVELOPE_LIMIT)
        throw new PayloadTooLargeError("Multipart fields exceed their byte limit.");
    }
  }
  try {
    await parser.start();
    while (!parser.finished) {
      const header = await parser.headers();
      if (header.fileName === undefined) {
        await skipField();
        continue;
      }
      if (header.name !== fieldName)
        throw new BadRequestError(`Unexpected upload field "${header.name}".`);
      if (!isAllowedMimeType(header.mimeType, allowUnknownMime))
        throw new BadRequestError(`File type "${header.mimeType}" is not allowed.`);
      const mimeType = header.mimeType;
      async function* file(): AsyncGenerator<Uint8Array> {
        let size = 0;
        let prefix = Buffer.alloc(0);
        let checked = false;
        const decoder = uploadTextDecoder(mimeType);
        try {
          for await (const chunk of parser.body()) {
            size += chunk.byteLength;
            if (size > maxBytes) throw new PayloadTooLargeError("Upload exceeds its byte limit.");
            validateUploadText(decoder, chunk);
            if (!checked) {
              const take = Math.min(12 - prefix.length, chunk.byteLength);
              prefix = Buffer.concat([prefix, chunk.subarray(0, take)]);
              if (prefix.length < 12) continue;
              assertUploadContentType(prefix, mimeType);
              checked = true;
              yield prefix;
              if (take < chunk.byteLength) yield chunk.subarray(take);
            } else yield chunk;
          }
          if (!size) throw new BadRequestError("Uploaded file is empty.");
          if (!checked) {
            assertUploadContentType(prefix, mimeType);
            yield prefix;
          }
          validateUploadText(decoder);
          while (!parser.finished) {
            const next = await parser.headers();
            if (next.fileName !== undefined)
              throw new BadRequestError("Only one uploaded file is accepted.");
            await skipField();
          }
          await parser.finish();
        } finally {
          await parser.close();
        }
      }
      const iterator = file();
      const stream = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const next = await iterator.next();
              if (next.done) controller.close();
              else controller.enqueue(next.value);
            } catch (error) {
              controller.error(error);
            }
          },
          async cancel(reason) {
            // Close first to unblock an in-flight source read before returning the iterator.
            await parser.close(reason);
            await iterator.return(undefined);
          },
        },
        { highWaterMark: 0 },
      );
      const name = header.fileName.split(/[/\\]/).pop()?.trim() ?? "upload";
      const safeName = name.replace(/[^\w.\-()+ ]+/g, "_").slice(0, 200) || "upload";
      return new UploadedFile(safeName, mimeType, stream);
    }
    throw new BadRequestError(`Missing upload field "${fieldName}".`);
  } catch (error) {
    await parser.close(error);
    throw error;
  }
}

export { parseMultipartUploadStream, UploadedFile };
