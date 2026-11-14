import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { CORE_STORAGE_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { S3Client } from "bun";
import { copyApplicationConfig } from "../config/configSnapshot";
import { assertPathUnderRoot } from "../security/safePath";

/** Missing reads return null; deletion is idempotent. All other failures reject. */
interface Storage {
  put(path: string, contents: string | Uint8Array): Promise<string>;
  get(path: string): Promise<Uint8Array | null>;
  delete(path: string): Promise<void>;
}

/** Buffered consumers need no streaming or concrete manager dependency. */
interface StorageDriver extends Storage {}

/** Streams are single-use. Late read errors reject reader.read(); cancellation closes the source. */
interface StreamingStorage extends Storage {
  readStream(path: string): Promise<ReadableStream<Uint8Array> | null>;
  writeStream(path: string, contents: ReadableStream<Uint8Array> | Blob): Promise<string>;
}

/** Narrow a consumer port when an operation requires native streaming support. */
function requireStreamingStorage(storage: Storage): StreamingStorage {
  if (
    !("readStream" in storage) ||
    typeof storage.readStream !== "function" ||
    !("writeStream" in storage) ||
    typeof storage.writeStream !== "function"
  )
    throw new TypeError("Storage does not support streaming.");
  if (storage instanceof StorageManager) return requireStreamingStorage(storage.streamingDriver());
  return storage as StreamingStorage;
}

// Prime one chunk so native missing-object errors retain the buffered API's null result.
async function openStream(
  source: ReadableStream<Uint8Array>,
  missingCode: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const reader = source.getReader();
  let first: Awaited<ReturnType<typeof reader.read>> | undefined;
  try {
    first = await reader.read();
  } catch (error) {
    reader.releaseLock();
    if (hasErrorCode(error, missingCode)) return null;
    throw error;
  }
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const next = first ?? (await reader.read());
          first = undefined;
          if (next.done) {
            reader.releaseLock();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          reader.releaseLock();
          controller.error(error);
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
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

class LocalStorageDriver implements StreamingStorage {
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

  async readStream(path: string): Promise<ReadableStream<Uint8Array> | null> {
    const absolutePath = this.resolvePath(path);
    try {
      if (!(await stat(absolutePath)).isFile()) throw new Error("Storage path is not a file.");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return null;
      throw error;
    }
    return openStream(Bun.file(absolutePath).stream(), "ENOENT");
  }

  async writeStream(path: string, contents: ReadableStream<Uint8Array> | Blob): Promise<string> {
    const absolutePath = this.resolvePath(path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await Bun.write(absolutePath, contents);
    return path;
  }

  async delete(path: string): Promise<void> {
    try {
      await unlink(this.resolvePath(path));
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return;
      throw error;
    }
  }
}

class S3StorageDriver implements StreamingStorage {
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

  readStream(path: string): Promise<ReadableStream<Uint8Array> | null> {
    return openStream(this.client.file(path.replace(/^\/+/, "")).stream(), "NoSuchKey");
  }

  async writeStream(path: string, contents: ReadableStream<Uint8Array> | Blob): Promise<string> {
    const file = this.client.file(path.replace(/^\/+/, ""));
    if (contents instanceof Blob) await file.write(contents);
    else {
      const writer = file.writer();
      try {
        await contents.pipeTo(
          new WritableStream<Uint8Array>({
            async write(chunk) {
              await writer.write(chunk);
            },
            async close() {
              await writer.end();
            },
          }),
        );
      } catch (error) {
        // A rejected sink write cancels the source but does not invoke sink.abort().
        // Explicitly terminate native multipart state and preserve the transfer error.
        try {
          await writer.end(error instanceof Error ? error : new Error(String(error)));
        } catch {
          /* The original transfer failure takes precedence over cleanup failure. */
        }
        throw error;
      }
    }
    return path;
  }

  async delete(path: string): Promise<void> {
    try {
      await this.client.unlink(path.replace(/^\/+/, ""));
    } catch (error) {
      if (hasErrorCode(error, "NoSuchKey")) return;
      throw error;
    }
  }
}

class StorageManager implements StreamingStorage {
  constructor(private readonly driver: StorageDriver) {}

  put(path: string, contents: string | Uint8Array): Promise<string> {
    return this.driver.put(path, contents);
  }

  get(path: string): Promise<Uint8Array | null> {
    return this.driver.get(path);
  }

  streamingDriver(): StreamingStorage {
    return requireStreamingStorage(this.driver);
  }

  readStream(path: string): Promise<ReadableStream<Uint8Array> | null> {
    if (!("readStream" in this.driver) || typeof this.driver.readStream !== "function")
      return Promise.reject(new TypeError("Storage driver does not support streaming reads."));
    return this.driver.readStream(path);
  }

  writeStream(path: string, contents: ReadableStream<Uint8Array> | Blob): Promise<string> {
    if (!("writeStream" in this.driver) || typeof this.driver.writeStream !== "function")
      return Promise.reject(new TypeError("Storage driver does not support streaming writes."));
    return this.driver.writeStream(path, contents);
  }

  delete(path: string): Promise<void> {
    return this.driver.delete(path);
  }
}

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

export type { S3StorageConfig, Storage, StorageConfig, StorageDriver, StreamingStorage };
export {
  CORE_STORAGE_TOKEN,
  createS3Client,
  createStorageDriver,
  LocalStorageDriver,
  requireStreamingStorage,
  resolveS3Config,
  resolveStorageConfig,
  S3StorageDriver,
  StorageManager,
  snapshotStorageConfig,
};
