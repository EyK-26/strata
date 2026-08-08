import { describe, expect, test } from "bun:test";
import { LocalStorageDriver, StorageManager } from "../../src/core/storage/storage";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
});
