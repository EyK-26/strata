import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface StorageDriver {
  put(path: string, contents: string | Uint8Array): Promise<string>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<boolean>;
}

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly rootDirectory: string) {}

  private resolvePath(path: string): string {
    return join(this.rootDirectory, path.replace(/^\/+/, ""));
  }

  async put(path: string, contents: string | Uint8Array): Promise<string> {
    const absolutePath = this.resolvePath(path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
    return path;
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.resolvePath(path));
    } catch {
      return null;
    }
  }

  async delete(path: string): Promise<boolean> {
    try {
      await unlink(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }
}

class StorageManager {
  constructor(private readonly driver: StorageDriver) {}

  put(path: string, contents: string | Uint8Array): Promise<string> {
    return this.driver.put(path, contents);
  }

  get(path: string): Promise<Uint8Array | null> {
    return this.driver.get(path);
  }

  delete(path: string): Promise<boolean> {
    return this.driver.delete(path);
  }
}

const defaultStorage = new StorageManager(
  new LocalStorageDriver(process.env.STORAGE_PATH ?? "storage"),
);

function storage(): StorageManager {
  return defaultStorage;
}

export { LocalStorageDriver, StorageManager, storage };
export type { StorageDriver };
