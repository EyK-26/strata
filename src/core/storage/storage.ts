import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { S3Client } from "bun";
import { assertPathUnderRoot } from "../security/safePath";

interface StorageDriver {
  put(path: string, contents: string | Uint8Array): Promise<string>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<boolean>;
}

interface S3StorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
  endpoint?: string;
}

class LocalStorageDriver implements StorageDriver {
  constructor(private readonly rootDirectory?: string) {}

  private resolveRootDirectory(): string {
    return this.rootDirectory ?? process.env.STORAGE_PATH ?? "storage";
  }

  private resolvePath(path: string): string {
    return assertPathUnderRoot(this.resolveRootDirectory(), path);
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

class S3StorageDriver implements StorageDriver {
  constructor(private readonly client: S3Client) {}

  async put(path: string, contents: string | Uint8Array): Promise<string> {
    await this.client.write(path.replace(/^\/+/, ""), contents);
    return path;
  }

  async get(path: string): Promise<Uint8Array | null> {
    const normalizedPath = path.replace(/^\/+/, "");
    const file = this.client.file(normalizedPath);

    if (!(await file.exists())) {
      return null;
    }

    return new Uint8Array(await file.arrayBuffer());
  }

  async delete(path: string): Promise<boolean> {
    try {
      await this.client.unlink(path.replace(/^\/+/, ""));
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

function resolveS3Config(): S3StorageConfig {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.AWS_BUCKET?.trim();

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      'STORAGE_DRIVER="s3" requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_BUCKET.',
    );
  }

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    ...(process.env.AWS_REGION?.trim() ? { region: process.env.AWS_REGION.trim() } : {}),
    ...(process.env.AWS_ENDPOINT?.trim() ? { endpoint: process.env.AWS_ENDPOINT.trim() } : {}),
  };
}

function createS3Client(config: S3StorageConfig = resolveS3Config()): S3Client {
  return new S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    ...(config.region ? { region: config.region } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
  });
}

function createStorageDriver(): StorageDriver {
  const driver = process.env.STORAGE_DRIVER ?? "local";

  if (driver === "s3") {
    return new S3StorageDriver(createS3Client());
  }

  return new LocalStorageDriver();
}

const defaultStorage = { current: null as StorageManager | null };

function storage(): StorageManager {
  if (!defaultStorage.current) {
    defaultStorage.current = new StorageManager(createStorageDriver());
  }

  return defaultStorage.current;
}

/** Test hook: drop the process-wide storage singleton (e.g. after changing STORAGE_PATH). */
function resetDefaultStorage(): void {
  defaultStorage.current = null;
}

export type { S3StorageConfig, StorageDriver };
export {
  createS3Client,
  createStorageDriver,
  LocalStorageDriver,
  resetDefaultStorage,
  resolveS3Config,
  S3StorageDriver,
  StorageManager,
  storage,
};
