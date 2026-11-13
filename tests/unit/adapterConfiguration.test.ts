import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CORE_MAIL_TOKEN,
  createMailDriver,
  Mailer,
  resolveSmtpConfig,
  SmtpMailDriver,
} from "@getstrata/core/mail/mailer";
import { createApplication } from "@getstrata/core/runtime/application";
import {
  CORE_STORAGE_TOKEN,
  createStorageDriver,
  LocalStorageDriver,
  resolveStorageConfig,
  snapshotStorageConfig,
} from "@getstrata/core/storage/storage";
import { createMailBindings } from "../../src/bootstrap/providers/mail";
import { createStorageBindings } from "../../src/bootstrap/providers/storage";

const message = { to: "recipient@example.test", subject: "fixture", body: "fixture" };

test("two applications keep storage roots captured before cwd, environment and caller config mutations", async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "strata-config-"));
  const previous = process.env.STORAGE_PATH;
  const original = { driver: "local" as const, rootDirectory: join(directory, "one") };
  const one = createApplication({ providers: [], services: createStorageBindings(original) });
  const env = { STORAGE_PATH: join(directory, "two") };
  const two = createApplication({
    providers: [],
    services: createStorageBindings(resolveStorageConfig(env)),
  });
  try {
    original.rootDirectory = join(directory, "redirected");
    env.STORAGE_PATH = original.rootDirectory;
    process.env.STORAGE_PATH = original.rootDirectory;
    process.chdir(directory);
    await one.start();
    await two.start();
    await one.run((scope) => scope.resolve(CORE_STORAGE_TOKEN).put("same.txt", "one"));
    await two.run((scope) => scope.resolve(CORE_STORAGE_TOKEN).put("same.txt", "two"));
    expect(await readFile(join(directory, "one/same.txt"), "utf8")).toBe("one");
    expect(await readFile(join(directory, "two/same.txt"), "utf8")).toBe("two");
    expect(await Bun.file(join(directory, "redirected/same.txt")).exists()).toBe(false);
  } finally {
    process.chdir(originalCwd);
    if (previous === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = previous;
    await one.stop();
    await two.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("local driver captures a relative root once and ignores STORAGE_PATH", async () => {
  const originalCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "strata-relative-config-"));
  try {
    process.chdir(directory);
    const driver = new LocalStorageDriver("owned");
    process.chdir(originalCwd);
    await driver.put("file.txt", "captured");
    expect(await readFile(join(directory, "owned/file.txt"), "utf8")).toBe("captured");
  } finally {
    process.chdir(originalCwd);
    await rm(directory, { recursive: true, force: true });
  }
});

test("SMTP driver copies caller configuration including nested TLS data and never rereads environment", async () => {
  const ca = Buffer.from("certificate");
  const options = {
    host: "original.test",
    port: 2525,
    from: "one@example.test",
    secure: true,
    ehloHost: "one.local",
    tls: { ca: [ca], serverName: "original.test" },
  };
  const captured: unknown[] = [];
  const driver = new SmtpMailDriver(options, async (config) => {
    captured.push(config);
  });
  options.host = "redirected.test";
  options.port = 1;
  options.from = "two@example.test";
  options.tls.serverName = "redirected.test";
  ca.fill(0);
  await driver.send(message);
  expect(captured[0]).toMatchObject({
    host: "original.test",
    port: 2525,
    from: "one@example.test",
    ehloHost: "one.local",
    tls: { serverName: "original.test" },
  });
  const config = captured[0] as typeof options;
  expect(Buffer.from(config.tls.ca[0] ?? Buffer.alloc(0)).toString()).toBe("certificate");
  expect(Object.isFrozen(config)).toBe(true);
  expect(Object.isFrozen(config.tls)).toBe(true);
});

test("invalid adapter configuration rejects during declaration before any application effects", () => {
  for (const invalid of ["unknown", "SMTP", ""])
    expect(() => createMailDriver({ MAIL_DRIVER: invalid })).toThrow();
  expect(() =>
    createMailDriver({
      MAIL_DRIVER: "smtp",
      MAIL_HOST: "smtp.test",
      MAIL_FROM: "sender@example.test",
      MAIL_SECURE: "tru",
    }),
  ).toThrow();
  expect(() =>
    createMailBindings({
      driver: "smtp",
      smtp: {
        host: "smtp.test",
        port: 2525,
        from: "sender@example.test",
        secure: false,
        username: "without-password",
      },
    }),
  ).toThrow();
  expect(() => createStorageDriver({ driver: "other" } as never)).toThrow();
  expect(() => resolveStorageConfig({ STORAGE_DRIVER: "s3" })).toThrow();
  expect(() =>
    snapshotStorageConfig({
      driver: "s3",
      s3: {
        accessKeyId: "fixture",
        secretAccessKey: "fixture",
        bucket: "fixture",
        endpoint: "file:///tmp/fixture",
      },
    }),
  ).toThrow();
  expect(() => createStorageBindings({ driver: "local", rootDirectory: "" })).toThrow();
  expect(
    () =>
      new SmtpMailDriver({ host: "smtp.test", port: 2525, from: "bad\r\naddress", secure: false }),
  ).toThrow();
});

test("custom mail and storage capabilities initialize independently of unused invalid environment", async () => {
  let sent = 0;
  const stored = new Map<string, Uint8Array>();
  const app = createApplication({
    providers: [],
    services: [
      ...createMailBindings({
        driver: "custom",
        mail: {
          async send() {
            sent++;
          },
        },
      }),
      ...createStorageBindings({
        driver: "custom",
        storage: {
          async put(path, contents) {
            stored.set(path, new TextEncoder().encode(String(contents)));
            return path;
          },
          async get(path) {
            return stored.get(path) ?? null;
          },
          async delete(path) {
            stored.delete(path);
          },
        },
      }),
    ],
  });
  try {
    await app.start();
    await app.run(async (scope) => {
      await scope.resolve(CORE_MAIL_TOKEN).send(message);
      const storage = scope.resolve(CORE_STORAGE_TOKEN);
      await storage.put("fixture", "value");
      expect(new TextDecoder().decode((await storage.get("fixture")) ?? new Uint8Array())).toBe(
        "value",
      );
      expect(await storage.delete("fixture")).toBeUndefined();
    });
    expect(sent).toBe(1);
  } finally {
    expect((await app.stop()).successful).toBe(true);
  }
});

test("environment SMTP assembly captures EHLO and returns immutable settings", () => {
  const env = {
    MAIL_HOST: "smtp.test",
    MAIL_FROM: "sender@example.test",
    MAIL_EHLO: "owned.local",
  };
  const config = resolveSmtpConfig(env);
  env.MAIL_EHLO = "redirected.local";
  expect(config.ehloHost).toBe("owned.local");
  expect(Object.isFrozen(config)).toBe(true);
  expect(new Mailer(createMailDriver({ MAIL_DRIVER: "log" }))).toBeInstanceOf(Mailer);
});

test("S3 application assembly snapshots endpoint, region and credentials despite native environment defaults", async () => {
  const requests: { url: string; headers: Headers }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({ url: request.url, headers: new Headers(request.headers) });
      return new Response("stored");
    },
  });
  const keys = [
    "S3_ENDPOINT",
    "AWS_ENDPOINT",
    "S3_REGION",
    "AWS_REGION",
    "S3_SESSION_TOKEN",
    "AWS_SESSION_TOKEN",
  ] as const;
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const options = {
    driver: "s3" as const,
    s3: {
      accessKeyId: "original-key",
      secretAccessKey: "original-secret",
      bucket: "owned",
      endpoint: `http://127.0.0.1:${server.port}`,
    },
  };
  const app = createApplication({ providers: [], services: createStorageBindings(options) });
  try {
    options.s3.endpoint = "http://127.0.0.1:1";
    options.s3.accessKeyId = "redirected-key";
    process.env.S3_ENDPOINT = "http://127.0.0.1:1";
    process.env.AWS_ENDPOINT = "http://127.0.0.1:1";
    process.env.S3_REGION = "redirected-region";
    process.env.AWS_REGION = "redirected-region";
    process.env.S3_SESSION_TOKEN = "ambient-token";
    process.env.AWS_SESSION_TOKEN = "ambient-token";
    await app.start();
    await app.run((scope) => scope.resolve(CORE_STORAGE_TOKEN).put("fixture.txt", "data"));
    expect(requests).toHaveLength(1);
    const signedUrl = new URL(requests[0]?.url ?? "http://missing.invalid");
    expect(requests[0]?.headers.get("authorization")).toContain("Credential=original-key/");
    expect(requests[0]?.headers.get("authorization")).toContain("/us-east-1/s3/");
    expect(requests[0]?.headers.get("x-amz-security-token")).toBeNull();
    expect(signedUrl.searchParams.get("X-Amz-Security-Token")).toBeNull();
    const defaultConfig = snapshotStorageConfig({
      driver: "s3",
      s3: { accessKeyId: "fixture", secretAccessKey: "fixture", bucket: "owned" },
    });
    expect(defaultConfig).toMatchObject({
      s3: { region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", sessionToken: "" },
    });
  } finally {
    await app.stop();
    await server.stop(true);
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
