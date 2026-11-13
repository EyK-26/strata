import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServiceToken } from "@getstrata/core/contracts/token";
import { S3Client } from "bun";
import { copyApplicationConfig } from "../config/configSnapshot";
import { assertPathUnderRoot } from "../security/safePath";

/** Missing objects are null/false; all other failures reject. */
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
  sessionToken?: string;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

class LocalStorageDriver implements StorageDriver {
  private readonly rootDirectory: string;

  constructor(rootDirectory = "storage") {
    if (typeof rootDirectory !== "string" || !rootDirectory.trim() || rootDirectory.includes("\0"))
      throw new TypeError("Storage rootDirectory must be a nonempty path without null bytes.");
    // Capture cwd once. Operations never consult ambient configuration.
    this.rootDirectory = resolve(rootDirectory);
  }

  private resolvePath(path: string): string {
    return assertPathUnderRoot(this.rootDirectory, path);
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
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
  }

  async delete(path: string): Promise<boolean> {
    try {
      await unlink(this.resolvePath(path));
      return true;
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return false;
      throw error;
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
    try {
      return new Uint8Array(await this.client.file(normalizedPath).arrayBuffer());
    } catch (error) {
      if (hasErrorCode(error, "NoSuchKey")) return null;
      throw error;
    }
  }

  async delete(path: string): Promise<boolean> {
    try {
      await this.client.unlink(path.replace(/^\/+/, ""));
      return true;
    } catch (error) {
      if (hasErrorCode(error, "NoSuchKey")) return false;
      throw error;
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

const CORE_STORAGE_TOKEN = createServiceToken<StorageManager>("core.storage");

type StorageConfig =
  | { readonly driver: "local"; readonly rootDirectory: string }
  | { readonly driver: "s3"; readonly s3: Readonly<S3StorageConfig> };

function snapshotStorageConfig(config: StorageConfig): StorageConfig {
  const snapshot = copyApplicationConfig(config) as unknown as StorageConfig;
  if (snapshot.driver === "local") {
    if (
      typeof snapshot.rootDirectory !== "string" ||
      !snapshot.rootDirectory.trim() ||
      snapshot.rootDirectory.includes("\0")
    )
      throw new TypeError("Storage rootDirectory must be a nonempty path without null bytes.");
    return Object.freeze({ driver: "local", rootDirectory: resolve(snapshot.rootDirectory) });
  }
  if (snapshot.driver !== "s3") throw new TypeError("Unknown storage driver.");
  const s3 = snapshot.s3;
  if (
    !s3 ||
    [s3.accessKeyId, s3.secretAccessKey, s3.bucket].some(
      (value) => typeof value !== "string" || !value.trim(),
    )
  )
    throw new TypeError("S3 storage requires accessKeyId, secretAccessKey, and bucket.");
  if (
    s3.region !== undefined &&
    (typeof s3.region !== "string" || !/^[a-z0-9-]+$/i.test(s3.region))
  )
    throw new TypeError("S3 region must be a nonempty string.");
  if (s3.endpoint !== undefined) {
    const endpoint = new URL(s3.endpoint);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
      throw new TypeError("S3 endpoint must be an HTTP(S) URL without credentials.");
  }
  if (s3.sessionToken !== undefined && typeof s3.sessionToken !== "string")
    throw new TypeError("S3 sessionToken must be a string.");
  const region = s3.region ?? "us-east-1";
  return Object.freeze({
    driver: "s3",
    s3: Object.freeze({
      ...s3,
      region,
      endpoint:
        s3.endpoint ?? `https://s3.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`,
      // Explicit empty token prevents Bun from consulting ambient AWS/S3 credentials later.
      sessionToken: s3.sessionToken ?? "",
    }),
  });
}

/** Configuration adapter: read environment only during assembly. */
function resolveS3Config(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Readonly<S3StorageConfig> {
  const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
  const bucket = env.AWS_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket)
    throw new Error(
      'STORAGE_DRIVER="s3" requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_BUCKET.',
    );
  return Object.freeze({
    accessKeyId,
    secretAccessKey,
    bucket,
    ...(env.AWS_REGION?.trim() || env.S3_REGION?.trim()
      ? { region: env.AWS_REGION?.trim() || env.S3_REGION?.trim() }
      : {}),
    ...(env.AWS_ENDPOINT?.trim() || env.S3_ENDPOINT?.trim()
      ? { endpoint: env.AWS_ENDPOINT?.trim() || env.S3_ENDPOINT?.trim() }
      : {}),
    ...(env.AWS_SESSION_TOKEN?.trim() || env.S3_SESSION_TOKEN?.trim()
      ? { sessionToken: env.AWS_SESSION_TOKEN?.trim() || env.S3_SESSION_TOKEN?.trim() }
      : {}),
  });
}

function resolveStorageConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): StorageConfig {
  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") return snapshotStorageConfig({ driver, s3: resolveS3Config(env) });
  if (driver !== "local") throw new TypeError("Unknown storage driver.");
  return snapshotStorageConfig({ driver, rootDirectory: env.STORAGE_PATH ?? "storage" });
}

function createS3Client(config: Readonly<S3StorageConfig>): S3Client {
  const snapshot = snapshotStorageConfig({ driver: "s3", s3: config });
  if (snapshot.driver !== "s3") throw new TypeError("S3 storage configuration required.");
  return new S3Client(snapshot.s3);
}

function createStorageDriver(config: StorageConfig): StorageDriver {
  const snapshot = snapshotStorageConfig(config);
  return snapshot.driver === "s3"
    ? new S3StorageDriver(createS3Client(snapshot.s3))
    : new LocalStorageDriver(snapshot.rootDirectory);
}

export type { S3StorageConfig, StorageConfig, StorageDriver };
export {
  CORE_STORAGE_TOKEN,
  createS3Client,
  createStorageDriver,
  LocalStorageDriver,
  resolveS3Config,
  resolveStorageConfig,
  S3StorageDriver,
  StorageManager,
  snapshotStorageConfig,
};
