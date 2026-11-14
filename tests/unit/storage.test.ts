import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createS3Client,
  createStorageDriver,
  LocalStorageDriver,
  requireStreamingStorage,
  resolveS3Config,
  S3StorageDriver,
  StorageManager,
} from "@getstrata/core/storage/storage";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("storage", () => {
  test("native local streams transfer large inputs, blobs, missing paths and reader cancellation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-streams-"));
    const storage = requireStreamingStorage(new StorageManager(new LocalStorageDriver(directory)));
    try {
      let produced = 0;
      const chunks = 256;
      await storage.writeStream(
        "large.bin",
        new ReadableStream<Uint8Array>(
          {
            pull(controller) {
              if (produced === chunks) return controller.close();
              controller.enqueue(new Uint8Array(65536).fill(produced++ % 251));
            },
          },
          { highWaterMark: 0 },
        ),
      );
      const stream = await storage.readStream("large.bin");
      expect(stream).not.toBeNull();
      if (!stream) throw new Error("Expected stream");
      const reader = stream.getReader();
      let offset = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (let index = 0; index < value.length; index++)
          if (value[index] !== Math.floor((offset + index) / 65536) % 251)
            throw new Error("stream byte mismatch");
        offset += value.length;
      }
      expect(offset).toBe(chunks * 65536);
      const cancelled = await storage.readStream("large.bin");
      if (!cancelled) throw new Error("Expected stream");
      await cancelled.cancel("consumer done");
      await storage.writeStream("blob.txt", new Blob(["blob contents"]));
      expect(new TextDecoder().decode((await storage.get("blob.txt")) ?? new Uint8Array())).toBe(
        "blob contents",
      );
      expect(await storage.readStream("missing")).toBeNull();
      await expect(storage.readStream("../escape")).rejects.toThrow();
      await expect(storage.writeStream("../escape", new Blob(["bad"]))).rejects.toThrow();
      await mkdir(join(directory, "folder"));
      await expect(storage.readStream("folder")).rejects.toThrow();
      const broken = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new Error("source failed"));
        },
      });
      await expect(storage.writeStream("broken", broken)).rejects.toThrow("source failed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("S3 streams preserve backpressure, cancellation, errors and normalized paths", async () => {
    let pulls = 0;
    let cancelled: unknown;
    let missing = false;
    let written = 0;
    let activeWrites = 0;
    const client = {
      file: mock((_path: string) => ({
        stream() {
          return new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                if (missing)
                  return controller.error(
                    Object.assign(new Error("missing"), { code: "NoSuchKey" }),
                  );
                pulls++;
                controller.enqueue(new Uint8Array(65536));
              },
              cancel(reason) {
                cancelled = reason;
              },
            },
            { highWaterMark: 0 },
          );
        },
        write: mock(async (_blob: Blob) => undefined),
        writer() {
          return {
            async write(chunk: Uint8Array) {
              activeWrites++;
              expect(activeWrites).toBe(1);
              await Promise.resolve();
              written += chunk.length;
              activeWrites--;
            },
            end: mock(async (error?: Error) => {
              if (error) throw error;
            }),
          };
        },
      })),
    };
    const storage = new S3StorageDriver(client as never);
    const stream = await storage.readStream("/object");
    if (!stream) throw new Error("Expected stream");
    expect(client.file).toHaveBeenCalledWith("object");
    expect(pulls).toBe(1);
    await Promise.resolve();
    expect(pulls).toBe(1);
    await stream.cancel("stop");
    expect(cancelled).toBe("stop");
    missing = true;
    expect(await storage.readStream("missing")).toBeNull();
    let produced = 0;
    await storage.writeStream(
      "/large",
      new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (produced++ === 128) return controller.close();
            controller.enqueue(new Uint8Array(65536));
          },
        },
        { highWaterMark: 0 },
      ),
    );
    expect(written).toBe(128 * 65536);
    await storage.writeStream("/blob", new Blob(["blob"]));
    const failed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("upload failed"));
      },
    });
    await expect(storage.writeStream("bad", failed)).rejects.toThrow("upload failed");
  });

  test("stream failures propagate and upload failures cancel the input", async () => {
    const failure = new Error("remote transfer failed");
    let cancelled: unknown;
    let reads = 0;
    const driver = new S3StorageDriver({
      file() {
        return {
          stream() {
            return new ReadableStream<Uint8Array>(
              {
                pull(controller) {
                  if (reads++ === 0) controller.enqueue(new Uint8Array([1]));
                  else controller.error(failure);
                },
              },
              { highWaterMark: 0 },
            );
          },
          writer() {
            return {
              async write() {
                throw failure;
              },
              async end() {},
            };
          },
        };
      },
    } as never);
    const stream = await driver.readStream("object");
    if (!stream) throw new Error("Expected stream");
    const reader = stream.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    await expect(reader.read()).rejects.toBe(failure);
    const input = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel(reason) {
          cancelled = reason;
        },
      },
      { highWaterMark: 0 },
    );
    await expect(driver.writeStream("object", input)).rejects.toBe(failure);
    expect(cancelled).toBe(failure);
  });

  test("legacy drivers retain buffered compatibility without claiming streaming support", () => {
    const storage = new StorageManager({
      async get() {
        return null;
      },
      async put(path) {
        return path;
      },
      async delete() {},
    });
    expect(() => requireStreamingStorage(storage)).toThrow("streaming");
  });

  test("local missing objects stay distinct from invalid paths and filesystem failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-storage-errors-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));
    try {
      expect(await storage.get("missing.txt")).toBeNull();
      expect(await storage.delete("missing.txt")).toBeUndefined();
      expect(await storage.delete("missing.txt")).toBeUndefined();
      await mkdir(join(directory, "folder"));
      await expect(storage.get("folder")).rejects.toThrow();
      await expect(storage.delete("folder")).rejects.toThrow();
      for (const path of ["../outside.txt", "", "bad\u0000path"]) {
        await expect(storage.get(path)).rejects.toThrow();
        await expect(storage.delete(path)).rejects.toThrow();
      }
      await storage.put("file.txt", "retained");
      await expect(storage.get("file.txt/child")).rejects.toThrow();
      await expect(storage.delete("file.txt/child")).rejects.toThrow();
      expect(new TextDecoder().decode((await storage.get("file.txt")) ?? new Uint8Array())).toBe(
        "retained",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("native Bun S3 errors preserve missing-key, bucket and authorization distinctions", async () => {
    let errorCode: string | undefined;
    let status = 200;
    let stored: Uint8Array | undefined;
    const methods: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        methods.push(request.method);
        if (errorCode)
          return new Response(
            `<Error><Code>${errorCode}</Code><Message>Fixture</Message></Error>`,
            {
              status,
              headers: { "Content-Type": "application/xml" },
            },
          );
        if (request.method === "PUT") {
          stored = new Uint8Array(await request.arrayBuffer());
          return new Response(null);
        }
        if (request.method === "GET") return new Response(stored);
        if (request.method === "DELETE") {
          stored = undefined;
          return new Response(null, { status: 204 });
        }
        return new Response(null, { status: 405 });
      },
    });
    const storage = new StorageManager(
      new S3StorageDriver(
        createS3Client({
          accessKeyId: "fixture",
          secretAccessKey: "fixture",
          bucket: "fixture",
          region: "us-east-1",
          endpoint: `http://127.0.0.1:${server.port}`,
        }),
      ),
    );
    try {
      // S3 returns 204 even for a key that never existed. No preceding read is needed.
      expect(await storage.delete("never-created.jpg")).toBeUndefined();
      expect(methods).toEqual(["DELETE"]);
      methods.length = 0;
      await storage.put("/image.jpg", "image bytes");
      expect(new TextDecoder().decode((await storage.get("/image.jpg")) ?? new Uint8Array())).toBe(
        "image bytes",
      );
      expect(methods).toEqual(["PUT", "GET"]);
      await storage.writeStream("/image.jpg", new Blob(["image bytes"]));
      const nativeStream = await storage.readStream("/image.jpg");
      if (!nativeStream) throw new Error("Expected native stream");
      expect(await Bun.readableStreamToText(nativeStream)).toBe("image bytes");
      errorCode = "NoSuchKey";
      status = 404;
      expect(await storage.get("image.jpg")).toBeNull();
      expect(await storage.readStream("image.jpg")).toBeNull();
      expect(await storage.delete("image.jpg")).toBeUndefined();
      for (const [code, httpStatus] of [
        ["NoSuchBucket", 404],
        ["AccessDenied", 403],
        ["InternalError", 500],
      ] as const) {
        errorCode = code;
        status = httpStatus;
        for (const operation of ["get", "delete"] as const) {
          await expect(storage[operation]("image.jpg")).rejects.toMatchObject({ code });
        }
        await expect(storage.put("image.jpg", "replacement")).rejects.toMatchObject({ code });
        await expect(storage.readStream("image.jpg")).rejects.toMatchObject({ code });
      }
      errorCode = undefined;
      expect(new TextDecoder().decode((await storage.get("image.jpg")) ?? new Uint8Array())).toBe(
        "image bytes",
      );
      expect(await storage.delete("image.jpg")).toBeUndefined();
      expect(stored).toBeUndefined();
      methods.length = 0;
      expect(await storage.delete("image.jpg")).toBeUndefined();
      expect(methods).toEqual(["DELETE"]);
      await server.stop(true);
      for (const operation of ["get", "delete"] as const) {
        await expect(storage[operation]("image.jpg")).rejects.toThrow();
      }
      await expect(storage.put("image.jpg", "replacement")).rejects.toThrow();
    } finally {
      await server.stop(true);
    }
  }, 30000);

  test("writes, reads, and deletes files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-storage-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));

    try {
      await storage.put("reports/summary.txt", "hello");
      const contents = await storage.get("reports/summary.txt");
      expect(new TextDecoder().decode(contents ?? new Uint8Array())).toBe("hello");
      expect(await storage.delete("reports/summary.txt")).toBeUndefined();
      expect(await storage.get("reports/summary.txt")).toBeNull();
      expect(await storage.delete("reports/summary.txt")).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("s3 driver delegates to the configured client", async () => {
    const client = {
      write: mock(async () => undefined),
      file: mock(() => ({
        arrayBuffer: mock(async () => new TextEncoder().encode("remote").buffer),
      })),
      unlink: mock(async () => undefined),
    };

    const driver = new S3StorageDriver(client as never);
    await driver.put("/reports/summary.txt", "hello");
    const contents = await driver.get("/reports/summary.txt");
    expect(new TextDecoder().decode(contents ?? new Uint8Array())).toBe("remote");
    expect(await driver.delete("/reports/summary.txt")).toBeUndefined();
  });

  test("resolveS3Config reads AWS environment variables", () => {
    const previous = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_BUCKET: process.env.AWS_BUCKET,
      AWS_REGION: process.env.AWS_REGION,
    };

    process.env.AWS_ACCESS_KEY_ID = "key";
    process.env.AWS_SECRET_ACCESS_KEY = "secret";
    process.env.AWS_BUCKET = "bucket";
    process.env.AWS_REGION = "eu-west-1";

    try {
      expect(resolveS3Config()).toEqual({
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucket: "bucket",
        region: "eu-west-1",
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("createStorageDriver defaults to local storage", () => {
    const previous = process.env.STORAGE_DRIVER;
    delete process.env.STORAGE_DRIVER;

    try {
      expect(createStorageDriver({ driver: "local", rootDirectory: "storage" })).toBeInstanceOf(
        LocalStorageDriver,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.STORAGE_DRIVER;
      } else {
        restoreEnvVar("STORAGE_DRIVER", previous);
      }
    }
  });
});
