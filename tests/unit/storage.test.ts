import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStorageDriver,
  LocalStorageDriver,
  resolveS3Config,
  S3StorageDriver,
  StorageManager,
} from "@getstrata/core/storage/storage";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("storage", () => {
  test("writes, reads, and deletes files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workhub-storage-"));
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
        exists: mock(async () => true),
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
