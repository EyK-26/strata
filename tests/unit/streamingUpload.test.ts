import { describe, expect, test } from "bun:test";
import { Buffer } from "node:buffer";
import { parseMultipartUpload, validateUploadFile } from "../../src/core/http/parseMultipartUpload";
import { parseMultipartUploadStream, UploadedFile } from "../../src/core/http/streamingUpload";

const BOUNDARY = "strata-upload-boundary";
const policy = { maxBytes: 1_000_000, allowUnknownMime: false };
type Part = {
  name?: string;
  filename?: string;
  mime?: string;
  body: Uint8Array | string;
  headers?: string[];
};
function multipart(parts: Part[], ending = "\r\n", boundary = BOUNDARY): Buffer {
  const chunks: Buffer[] = [];
  for (const [index, part] of parts.entries()) {
    chunks.push(Buffer.from(`${index ? "\r\n" : ""}--${boundary}\r\n`));
    const headers = part.headers ?? [
      `Content-Disposition: form-data; name="${part.name ?? "file"}"${part.filename === undefined ? "" : `; filename="${part.filename}"`}`,
      ...(part.mime === undefined ? [] : [`Content-Type: ${part.mime}`]),
    ];
    chunks.push(Buffer.from(`${headers.join("\r\n")}\r\n\r\n`), Buffer.from(part.body));
  }
  chunks.push(Buffer.from(`\r\n--${boundary}--${ending}`));
  return Buffer.concat(chunks);
}
function file(body: Uint8Array | string = "hello streaming upload", mime = "text/plain"): Part {
  return { name: "file", filename: "sample.txt", mime, body };
}
function source(
  chunks: readonly Uint8Array[],
  options: { cancelError?: Error; readError?: Error } = {},
) {
  const state = { reads: 0, cancelled: 0, reason: undefined as unknown };
  let index = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.reads++;
        if (options.readError) {
          controller.error(options.readError);
          return;
        }
        const chunk = chunks[index++];
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
      cancel(reason) {
        state.cancelled++;
        state.reason = reason;
        if (options.cancelError) throw options.cancelError;
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, state };
}
function requestFrom(
  chunks: readonly Uint8Array[],
  contentType = `multipart/form-data; boundary=${BOUNDARY}`,
) {
  const input = source(chunks);
  return {
    ...input,
    request: new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": contentType },
      body: input.stream,
    }),
  };
}
async function upload(raw: Uint8Array, options = policy) {
  const { request } = requestFrom([raw]);
  return parseMultipartUploadStream(request, "file", options);
}
async function rejectParse(raw: Uint8Array, message: string, options = policy) {
  const input = requestFrom([raw]);
  await expect(parseMultipartUploadStream(input.request, "file", options)).rejects.toThrow(message);
  expect(input.stream.locked).toBe(false);
}
async function rejectBody(raw: Uint8Array, message: string, options = policy) {
  const input = requestFrom([raw]);
  const selected = await parseMultipartUploadStream(input.request, "file", options);
  await expect(selected.bytes()).rejects.toThrow(message);
  expect(input.stream.locked).toBe(false);
}
function tinyChunks(bytes: Uint8Array, size = 1): Uint8Array[] {
  return Array.from({ length: Math.ceil(bytes.length / size) }, (_, index) =>
    bytes.subarray(index * size, (index + 1) * size),
  );
}

describe("streaming multipart uploads", () => {
  test("native FormData roundtrip accepts text fields before and after one file", async () => {
    const form = new FormData();
    form.set("title", "before");
    form.set("file", new File(["hello € 🌍"], "hello.txt", { type: "text/plain" }));
    form.set("description", "after");
    const request = new Request("http://localhost/upload", { method: "POST", body: form });
    const selected = await parseMultipartUploadStream(request);
    expect(selected).toBeInstanceOf(UploadedFile);
    expect(selected.fileName).toBe("hello.txt");
    expect(selected.mimeType).toBe("text/plain");
    expect(new TextDecoder().decode(await selected.bytes())).toBe("hello € 🌍");
    expect(request.body?.locked).toBe(false);
    expect(() => selected.stream()).toThrow("already been consumed");
    expect(() => selected.bytes()).toThrow("already been consumed");
    await expect(selected.discard()).rejects.toThrow("already been consumed");
  });

  test("every byte split preserves binary boundary lookalikes and multipart metadata", async () => {
    const payload = Buffer.concat([
      Buffer.from([0, 255, 13, 10]),
      Buffer.from(`start\r\n--${BOUNDARY}X\r\n--${BOUNDARY}--X\r\n--${BOUNDARY}-\r\nend`),
      Buffer.from([128, 0]),
    ]);
    const raw = multipart([
      { name: "before", body: "metadata" },
      file(payload, "application/octet-stream"),
      { name: "after", body: "tail" },
    ]);
    for (let split = 0; split <= raw.length; split++) {
      const input = requestFrom([raw.subarray(0, split), raw.subarray(split)]);
      const selected = await parseMultipartUploadStream(input.request, "file", {
        ...policy,
        allowUnknownMime: true,
      });
      expect(Buffer.from(await selected.bytes())).toEqual(payload);
      expect(input.stream.locked).toBe(false);
    }
    for (const ending of ["", "\r\n"]) {
      const input = requestFrom(tinyChunks(multipart([file("€text🌍")], ending)));
      const selected = await parseMultipartUploadStream(input.request);
      expect(new TextDecoder().decode(await selected.bytes())).toBe("€text🌍");
    }
  });

  test("normalizes MIME parameters and sanitizes filenames without trusting paths", async () => {
    const selected = await upload(multipart([file("valid", " TEXT/PLAIN; charset=utf-8")]));
    expect(selected.mimeType).toBe("text/plain");
    await selected.discard();
    for (const [name, expected] of [
      ["../folder/hello?.txt", "hello_.txt"],
      ["..\\\\folder\\\\safe.txt", "safe.txt"],
      ["   ", "upload"],
      ["x".repeat(220), "x".repeat(200)],
      ['a\\"b.txt', "a_b.txt"],
    ] as const) {
      const selected = await upload(multipart([{ ...file(), filename: name }]));
      expect(selected.fileName).toBe(expected);
      await selected.discard();
    }
    const tokenParameters = multipart([file("token parameters")])
      .toString()
      .replace('name="file"', "name = file")
      .replace(/filename="[^"]*"/, "filename = plain.txt");
    expect(
      new TextDecoder().decode(await (await upload(Buffer.from(tokenParameters))).bytes()),
    ).toBe("token parameters");
    const raw = multipart([file("quoted boundary")], "\r\n", "quoted boundary");
    const input = requestFrom([raw], 'multipart/form-data; boundary="quoted boundary"');
    expect(
      new TextDecoder().decode(await (await parseMultipartUploadStream(input.request)).bytes()),
    ).toBe("quoted boundary");
  });

  test("validates file signatures across chunks and text UTF-8 through EOF", async () => {
    const signatures: Array<[string, number[] | string]> = [
      ["image/jpeg", [255, 216, 255]],
      ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
      ["image/gif", "GIF87a"],
      ["image/gif", "GIF89a"],
      ["image/webp", "RIFF1234WEBP"],
      ["application/pdf", "%PDF-1.7"],
      ["application/zip", [80, 75, 3, 4]],
      ["application/zip", [80, 75, 5, 6]],
      ["application/x-zip-compressed", [80, 75, 7, 8]],
    ];
    for (const [mime, prefix] of signatures) {
      const bytes = Buffer.concat([Buffer.from(prefix), Buffer.from("content after signature")]);
      const input = requestFrom(tinyChunks(multipart([file(bytes, mime)]), 2));
      expect(Buffer.from(await (await parseMultipartUploadStream(input.request)).bytes())).toEqual(
        bytes,
      );
      await rejectBody(multipart([file("wrong signature", mime)]), "does not match");
    }
    for (const bytes of [
      Buffer.from([0xc3, 0x28]),
      Buffer.from([0xc3]),
      Buffer.from([0]),
      Buffer.from("valid prefix and then\0binary"),
    ])
      await rejectBody(multipart([file(bytes)]), "valid UTF-8");
    for (const mime of ["text/csv", "application/json"])
      expect(
        new TextDecoder().decode(
          await (await upload(multipart([file("valid € text", mime)]))).bytes(),
        ),
      ).toBe("valid € text");
    await rejectBody(multipart([file("")]), "empty");
    const unknown = await upload(multipart([{ ...file("unclassified"), mime: undefined }]), {
      ...policy,
      allowUnknownMime: true,
    });
    expect(unknown.mimeType).toBe("application/octet-stream");
    await unknown.discard();
    await rejectParse(multipart([file("unclassified", "application/octet-stream")]), "not allowed");
    await rejectParse(multipart([file("bad", "text/html")]), "not allowed");
  });

  test("rejects missing, unexpected and duplicate files, including files after text fields", async () => {
    await rejectParse(
      multipart([{ name: "title", body: "only metadata" }]),
      "Missing upload field",
    );
    await rejectParse(multipart([{ ...file(), name: "avatar" }]), "Unexpected upload field");
    await rejectBody(
      multipart([file(), { name: "tail", body: "metadata" }, file("second")]),
      "Only one uploaded file",
    );
    await rejectBody(
      multipart([file(), { ...file("second"), name: "avatar" }]),
      "Only one uploaded file",
    );
  });

  test("rejects invalid boundaries, missing bodies and unsafe byte limits before reading", async () => {
    for (const contentType of [
      "",
      "text/plain",
      "multipart/form-data",
      "multipart/form-data; boundary=",
      `multipart/form-data; boundary=${"x".repeat(71)}`,
      'multipart/form-data; boundary="trailing "',
      "multipart/form-data; boundary=x; extra=y",
      'multipart/form-data; boundary="bad@boundary"',
    ]) {
      const input = requestFrom([multipart([file()])], contentType);
      await expect(parseMultipartUploadStream(input.request)).rejects.toThrow(
        "valid boundary and body",
      );
      expect(input.state.reads).toBe(0);
    }
    await expect(
      parseMultipartUploadStream(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        }),
      ),
    ).rejects.toThrow("valid boundary and body");
    for (const maxBytes of [
      0,
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const input = requestFrom([multipart([file()])]);
      await expect(
        parseMultipartUploadStream(input.request, "file", { ...policy, maxBytes }),
      ).rejects.toThrow("positive safe integer");
      expect(input.state.reads).toBe(0);
    }
    await rejectParse(Buffer.from("wrong\r\n"), "opening boundary");
    await rejectParse(Buffer.from("--incomplete"), "Truncated multipart request");
    await rejectParse(Buffer.from("x".repeat(80)), "header exceeds");
  });

  test("rejects malformed headers and disposition metadata", async () => {
    const cases: Array<[string[], string]> = [
      [["Broken header"], "Invalid multipart header"],
      [
        [
          'Content-Disposition: form-data; name="file"; filename="x"',
          "content-disposition: form-data",
        ],
        "Duplicate multipart header",
      ],
      [
        [
          'Content-Disposition: form-data; name="file"; filename="x"',
          "Content-Transfer-Encoding: base64",
        ],
        "Encoded multipart",
      ],
      [['Content-Disposition: attachment; name="file"'], "form-data disposition"],
      [["Content-Type: text/plain"], "form-data disposition"],
      [["Content-Disposition: form-data; name=()"], "disposition parameters"],
      [
        ['Content-Disposition: form-data; name="file"; name="again"'],
        "Duplicate multipart disposition",
      ],
      [['Content-Disposition: form-data; filename="x"'], "field name is required"],
      [['Content-Disposition: form-data; name=""; filename="x"'], "field name is required"],
      [
        ['Content-Disposition: form-data; name="file"; filename="x"', "X-Null: \0"],
        "Invalid multipart header",
      ],
    ];
    for (const [headers, message] of cases)
      await rejectParse(multipart([{ body: "x", headers }]), message);
    await rejectParse(
      Buffer.concat([
        Buffer.from(`--${BOUNDARY}\r\nX: `),
        Buffer.from([255]),
        Buffer.from("\r\n\r\nx"),
      ]),
      "Invalid multipart headers",
    );
    await rejectParse(
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data`),
      "Truncated multipart request",
    );
  });

  test("enforces file, envelope, header and field count limits", async () => {
    const exact = await upload(multipart([file("123456789012")]), { ...policy, maxBytes: 12 });
    expect((await exact.bytes()).length).toBe(12);
    await rejectBody(multipart([file("1234567890123")]), "Upload exceeds", {
      ...policy,
      maxBytes: 12,
    });
    await rejectParse(Buffer.alloc(65_538), "Multipart request exceeds", {
      ...policy,
      maxBytes: 1,
    });
    await rejectParse(
      multipart([{ body: "x", headers: [`X-Long: ${"x".repeat(16 * 1024)}`] }]),
      "header exceeds",
    );
    await rejectParse(
      multipart([{ name: "large", body: "x".repeat(65_537) }, file()]),
      "fields exceed",
    );
    await rejectBody(
      multipart([file(), { name: "large", body: "x".repeat(65_537) }]),
      "fields exceed",
    );
    const fields = Array.from({ length: 32 }, (_, index) => ({ name: `field${index}`, body: "" }));
    await rejectParse(multipart([...fields, file()]), "Too many multipart fields");
    await rejectBody(multipart([file(), ...fields]), "Too many multipart fields");
  });

  test("rejects truncated file framing and data after the closing boundary", async () => {
    const raw = multipart([file()]);
    for (const cut of [1, 3, BOUNDARY.length + 8])
      await rejectBody(raw.subarray(0, raw.length - cut), "Truncated multipart body");
    await rejectBody(Buffer.concat([raw, Buffer.from("epilogue")]), "Unexpected data after");
    const failure = new Error("network source failed");
    const input = source([], { readError: failure });
    await expect(
      parseMultipartUploadStream(
        new Request("http://localhost", {
          method: "POST",
          headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
          body: input.stream,
        }),
      ),
    ).rejects.toBe(failure);
    expect(input.stream.locked).toBe(false);
  });

  test("does not drain file content before consumption and cancels when discarded", async () => {
    const chunks = tinyChunks(multipart([file("x".repeat(512))]), 1);
    const input = requestFrom(chunks);
    const selected = await parseMultipartUploadStream(input.request);
    const before = input.state.reads;
    expect(before).toBeLessThan(chunks.length / 2);
    await Promise.resolve();
    expect(input.state.reads).toBe(before);
    await selected.discard();
    expect(input.state.cancelled).toBe(1);
    expect(input.stream.locked).toBe(false);
    expect(() => selected.stream()).toThrow("already been consumed");
  });

  test("stream backpressure stops pulling until requested and forwards cancellation reason", async () => {
    const input = requestFrom(tinyChunks(multipart([file("x".repeat(512))]), 8));
    const selected = await parseMultipartUploadStream(input.request);
    const stream = selected.stream();
    const reader = stream.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    const reads = input.state.reads;
    await Promise.resolve();
    await Promise.resolve();
    expect(input.state.reads).toBe(reads);
    const reason = new Error("consumer stopped");
    await reader.cancel(reason);
    expect(input.state.cancelled).toBe(1);
    expect(input.state.reason).toBe(reason);
    expect(input.stream.locked).toBe(false);
    reader.releaseLock();
  });

  test("cancels an in-flight source read and releases its request lock", async () => {
    let cancellation: unknown;
    let sent = false;
    const input = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(multipart([file("long enough prefix")]).subarray(0, -30));
          }
        },
        cancel(reason) {
          cancellation = reason;
        },
      },
      { highWaterMark: 0 },
    );
    const selected = await parseMultipartUploadStream(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: input,
      }),
    );
    const reader = selected.stream().getReader();
    const pending = reader.read();
    await Promise.resolve();
    const reason = new Error("cancel pending read");
    await reader.cancel(reason);
    await pending;
    expect(cancellation).toBe(reason);
    expect(input.locked).toBe(false);
    reader.releaseLock();
  });

  test("store streams to generated keys and cleans partially written failures", async () => {
    const entries = new Map<string, Uint8Array>([["uploads/existing", Buffer.from("keep")]]);
    const storage = {
      async writeStream(key: string, stream: ReadableStream<Uint8Array> | Blob) {
        entries.set(key, await new Response(stream).bytes());
        return key;
      },
      async delete(key: string) {
        entries.delete(key);
      },
    };
    const first = await (await upload(multipart([file("stored first")]))).store(storage);
    const second = await (await upload(multipart([file("stored second")]))).store(
      storage,
      "assets/images",
    );
    const root = await (await upload(multipart([file("root")]))).store(storage, "");
    expect(first).toMatch(/^uploads\/[0-9a-f-]{36}$/);
    expect(second).toMatch(/^assets\/images\/[0-9a-f-]{36}$/);
    expect(root).toMatch(/^[0-9a-f-]{36}$/);
    expect(new TextDecoder().decode(entries.get(first))).toBe("stored first");
    expect(new TextDecoder().decode(entries.get("uploads/existing"))).toBe("keep");
    const deleted: string[] = [];
    await expect(
      (await upload(multipart([file("wrong signature", "image/png")]))).store({
        async writeStream(key, stream) {
          entries.set(key, Buffer.from("partial"));
          await new Response(stream).bytes();
          return key;
        },
        async delete(key) {
          deleted.push(key);
          entries.delete(key);
        },
      }),
    ).rejects.toThrow("does not match");
    expect(deleted).toHaveLength(1);
    expect(entries.has(deleted[0] as string)).toBe(false);
    expect(entries.has("uploads/existing")).toBe(true);
  });

  test("store removes data already streamed when trailing multipart validation fails", async () => {
    const raw = multipart([file("first file bytes"), file("unexpected second file")]);
    const selected = await upload(raw);
    const entries = new Map<string, Uint8Array>([["uploads/existing", Buffer.from("keep")]]);
    let written = Buffer.alloc(0);
    let partialKey = "";
    await expect(
      selected.store({
        async writeStream(key, stream) {
          if (stream instanceof Blob) throw new Error("Expected a stream fixture");
          const reader = stream.getReader();
          partialKey = key;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) return key;
              written = Buffer.concat([written, chunk.value]);
              entries.set(key, written);
            }
          } finally {
            reader.releaseLock();
          }
        },
        async delete(key) {
          entries.delete(key);
        },
      }),
    ).rejects.toThrow("Only one uploaded file");
    expect(written.toString()).toBe("first file bytes");
    expect(entries.has(partialKey)).toBe(false);
    expect(entries.get("uploads/existing")).toEqual(Buffer.from("keep"));
  });

  test("store releases an unacquired stream on driver failure and preserves both cleanup errors", async () => {
    const primary = new Error("write failed");
    const cleanup = new Error("delete failed");
    const input = requestFrom(tinyChunks(multipart([file("x".repeat(200))])));
    const selected = await parseMultipartUploadStream(input.request);
    const deleted: string[] = [];
    await expect(
      selected.store({
        async writeStream() {
          throw primary;
        },
        async delete(key) {
          deleted.push(key);
        },
      }),
    ).rejects.toBe(primary);
    expect(deleted).toHaveLength(1);
    expect(input.state.cancelled).toBe(1);
    const another = await upload(multipart([file()]));
    try {
      await another.store({
        async writeStream() {
          throw primary;
        },
        async delete() {
          throw cleanup;
        },
      });
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([primary, cleanup]);
    }
  });

  test("invalid store directories reject before consuming the upload", async () => {
    const selected = await upload(multipart([file("still usable")]));
    const storage = {
      async writeStream() {
        throw new Error("must not write");
      },
      async delete() {},
    };
    for (const directory of [
      "../escape",
      ".",
      "uploads/..",
      "/absolute",
      "double//slash",
      "back\\slash",
      "nul\0byte",
      "trailing/",
      1,
    ])
      await expect(selected.store(storage, directory as string)).rejects.toThrow("relative path");
    expect(new TextDecoder().decode(await selected.bytes())).toBe("still usable");
  });

  test("rejects delayed epilogues immediately without draining more request chunks", async () => {
    const raw = multipart([file()]);
    const input = requestFrom([raw, Buffer.from("unexpected"), Buffer.alloc(100_000)]);
    const selected = await parseMultipartUploadStream(input.request);
    await expect(selected.bytes()).rejects.toThrow("Unexpected data after");
    expect(input.state.reads).toBe(2);
    expect(input.state.cancelled).toBe(1);
    expect(input.stream.locked).toBe(false);
  });

  test("snapshots the file byte limit before deferred consumption", async () => {
    const mutable = { maxBytes: 12, allowUnknownMime: false };
    const selected = await upload(multipart([file("123456789012")]), mutable);
    mutable.maxBytes = 1;
    expect(new TextDecoder().decode(await selected.bytes())).toBe("123456789012");
    const strict = { maxBytes: 12, allowUnknownMime: false };
    const tooLarge = await upload(multipart([file("1234567890123")]), strict);
    strict.maxBytes = 1_000_000;
    await expect(tooLarge.bytes()).rejects.toThrow("Upload exceeds");
  });

  test("store cancels requests even when the failing driver retains a downstream reader", async () => {
    const failure = new Error("driver failed while holding reader");
    const input = requestFrom(tinyChunks(multipart([file("x".repeat(1000))]), 8));
    const selected = await parseMultipartUploadStream(input.request);
    let downstream: { releaseLock(): void } | undefined;
    const deleted: string[] = [];
    await expect(
      selected.store({
        async writeStream(_key, stream) {
          if (stream instanceof Blob) throw new Error("Expected a stream fixture");
          const held = stream.getReader();
          downstream = held;
          expect((await held.read()).done).toBe(false);
          throw failure;
        },
        async delete(key) {
          deleted.push(key);
        },
      }),
    ).rejects.toBe(failure);
    expect(input.state.cancelled).toBe(1);
    expect(input.stream.locked).toBe(false);
    expect(deleted).toHaveLength(1);
    downstream?.releaseLock();
  });

  test("store rejects incomplete driver success and forwards explicit driver cancellation", async () => {
    for (const cancel of [false, true]) {
      const input = requestFrom(tinyChunks(multipart([file("x".repeat(100))]), 4));
      const selected = await parseMultipartUploadStream(input.request);
      const reason = new Error("driver deliberately cancelled");
      const deleted: string[] = [];
      await expect(
        selected.store({
          async writeStream(_key, stream) {
            if (stream instanceof Blob) throw new Error("Expected a stream fixture");
            if (cancel) await stream.cancel(reason);
            return _key;
          },
          async delete(key) {
            deleted.push(key);
          },
        }),
      ).rejects.toThrow("did not consume");
      expect(input.state.cancelled).toBe(1);
      if (cancel) expect(input.state.reason).toBe(reason);
      expect(input.stream.locked).toBe(false);
      expect(deleted).toHaveLength(1);
    }
  });

  test("store keeps the primary failure when upstream cancellation also fails", async () => {
    const primary = new Error("write failed");
    const input = source(tinyChunks(multipart([file("x".repeat(100))]), 4), {
      cancelError: new Error("cancel failed"),
    });
    const selected = await parseMultipartUploadStream(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: input.stream,
      }),
    );
    let deleted = false;
    await expect(
      selected.store({
        async writeStream() {
          throw primary;
        },
        async delete() {
          deleted = true;
        },
      }),
    ).rejects.toBe(primary);
    expect(deleted).toBe(true);
    expect(input.stream.locked).toBe(false);
  });

  test("buffered and streaming APIs agree on content, duplicate files and size rejection", async () => {
    const cases = [
      {
        raw: multipart([file("not a png", "image/png")]),
        options: policy,
        message: "does not match",
        status: 400,
      },
      {
        raw: multipart([file(Buffer.from([0xc3]))]),
        options: policy,
        message: "valid UTF-8",
        status: 400,
      },
      {
        raw: multipart([file(), file("second")]),
        options: policy,
        message: "Only one uploaded file",
        status: 400,
      },
      {
        raw: multipart([file("1234567890123")]),
        options: { ...policy, maxBytes: 12 },
        message: "Upload exceeds",
        status: 413,
      },
      {
        raw: multipart([file(), { name: "metadata", body: "x".repeat(65_537) }]),
        options: policy,
        message: "fields exceed",
        status: 413,
      },
      {
        raw: Buffer.alloc(65_538),
        options: { ...policy, maxBytes: 1 },
        message: "Multipart request exceeds",
        status: 413,
      },
    ];
    for (const { raw, options, message, status } of cases) {
      for (const buffered of [false, true]) {
        const input = requestFrom([raw]);
        const result = buffered
          ? parseMultipartUpload(input.request, "file", options)
          : parseMultipartUploadStream(input.request, "file", options).then((selected) =>
              selected.bytes(),
            );
        await expect(result).rejects.toMatchObject({
          status,
          message: expect.stringContaining(message),
        });
        expect(input.stream.locked).toBe(false);
      }
    }
    const raw = multipart([
      { name: "before", body: "text" },
      file("buffered contents"),
      { name: "after", body: "text" },
    ]);
    const input = requestFrom(tinyChunks(raw));
    expect(await parseMultipartUpload(input.request)).toEqual({
      fileName: "sample.txt",
      mimeType: "text/plain",
      size: 17,
      contents: Buffer.from("buffered contents"),
    });
  });

  test("both upload APIs reject nonboolean unknown-MIME opt-ins before reading", async () => {
    for (const allowUnknownMime of ["true", 1, null, undefined, {}]) {
      const invalid = { maxBytes: 1000, allowUnknownMime } as unknown as typeof policy;
      for (const buffered of [false, true]) {
        const input = requestFrom([multipart([file("unknown", "application/octet-stream")])]);
        const result = buffered
          ? parseMultipartUpload(input.request, "file", invalid)
          : parseMultipartUploadStream(input.request, "file", invalid);
        await expect(result).rejects.toThrow("boolean");
        expect(input.state.reads).toBe(0);
      }
      await expect(
        validateUploadFile(new File(["text"], "file.txt", { type: "text/plain" }), "file", invalid),
      ).rejects.toThrow("boolean");
    }
  });

  test("cancel failures still release the source lock", async () => {
    const failure = new Error("source cancel failed");
    const raw = multipart([file("x".repeat(100))]);
    const input = source(tinyChunks(raw, 4), { cancelError: failure });
    const selected = await parseMultipartUploadStream(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
        body: input.stream,
      }),
    );
    await expect(selected.discard()).rejects.toBe(failure);
    expect(input.stream.locked).toBe(false);
  });
});
