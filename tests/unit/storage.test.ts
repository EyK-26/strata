import { describe, expect, mock, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createS3Client,
  createStorageDriver,
  LocalStorageDriver,
  resolveS3Config,
  S3StorageDriver,
  StorageManager,
} from "@getstrata/core/storage/storage";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("storage", () => {
  test("local missing objects stay distinct from invalid paths and filesystem failures", async () => {
    const directory = await mkdtemp(join(tmpdir(), "strata-storage-errors-"));
    const storage = new StorageManager(new LocalStorageDriver(directory));
    try {
      expect(await storage.get("missing.txt")).toBeNull();
      expect(await storage.delete("missing.txt")).toBe(false);
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
      await storage.put("/image.jpg", "image bytes");
      expect(new TextDecoder().decode((await storage.get("/image.jpg")) ?? new Uint8Array())).toBe(
        "image bytes",
      );
      expect(methods).toEqual(["PUT", "GET"]);
      errorCode = "NoSuchKey";
      status = 404;
      expect(await storage.get("image.jpg")).toBeNull();
      expect(await storage.delete("image.jpg")).toBe(false);
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
      }
      errorCode = undefined;
      expect(new TextDecoder().decode((await storage.get("image.jpg")) ?? new Uint8Array())).toBe(
        "image bytes",
      );
      expect(await storage.delete("image.jpg")).toBe(true);
      expect(stored).toBeUndefined();
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
      expect(await storage.delete("reports/summary.txt")).toBe(true);
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
    expect(await driver.delete("/reports/summary.txt")).toBe(true);
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
      expect(createStorageDriver()).toBeInstanceOf(LocalStorageDriver);
    } finally {
      if (previous === undefined) {
        delete process.env.STORAGE_DRIVER;
      } else {
        restoreEnvVar("STORAGE_DRIVER", previous);
      }
    }
  });
});
