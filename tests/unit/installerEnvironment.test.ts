import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installerEnvironment } from "../../scripts/installer-environment";

test("installer environment preserves explicit proxy, CA trust and cache settings", () => {
  const operational = {
    PATH: "/host/bin",
    HOME: "/host/home",
    TMPDIR: "/host/tmp",
    USER: "installer",
    SHELL: "/bin/sh",
    BUN_TMPDIR: "/host/bun-tmp",
    HTTP_PROXY: "http://upper-http.invalid:8080",
    HTTPS_PROXY: "http://upper-https.invalid:8080",
    ALL_PROXY: "http://upper-all.invalid:8080",
    NO_PROXY: "localhost,127.0.0.1",
    http_proxy: "http://lower-http.invalid:8080",
    https_proxy: "http://lower-https.invalid:8080",
    all_proxy: "http://lower-all.invalid:8080",
    no_proxy: "",
    NODE_EXTRA_CA_CERTS: "/host/proxy-ca.pem",
    SSL_CERT_FILE: "/host/trust.pem",
    SSL_CERT_DIR: "/host/certs",
    BUN_INSTALL_CACHE_DIR: "/host/bun-cache",
    NPM_CONFIG_CACHE: "/host/npm-upper-cache",
    npm_config_cache: "/host/npm-lower-cache",
  };
  expect(installerEnvironment(operational)).toEqual(operational);
});

test("installer environment excludes application secrets and TLS-disabling or preload settings", () => {
  expect(
    installerEnvironment({
      PATH: "/host/bin",
      DATABASE_URL: "postgres://application-secret.invalid/shared",
      APP_DATABASE_URL: "postgres://runtime-secret.invalid/shared",
      MIGRATION_DATABASE_URL: "postgres://migration-secret.invalid/shared",
      SESSION_SECRET: "session-secret",
      JWT_SECRET: "jwt-secret",
      TOKEN_HASH_PEPPER: "token-secret",
      BUN_PUBLIC_SECRET: "must-not-become-public",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      BUN_TLS_REJECT_UNAUTHORIZED: "0",
      NPM_CONFIG_STRICT_SSL: "false",
      npm_config_strict_ssl: "false",
      NODE_OPTIONS: "--require /host/untrusted-preload.cjs",
      BUN_OPTIONS: "--preload /host/untrusted-preload.ts",
      npm_config_registry: "https://unrelated-registry.invalid",
      UNRECOGNIZED_HOST_SETTING: "not-allowlisted",
    }),
  ).toEqual({ PATH: "/host/bin" });
});

test("ordinary installer environments omit absent settings and remain independent of their source", () => {
  const source = Object.freeze({ PATH: "/host/bin", HTTP_PROXY: undefined });
  const environment = installerEnvironment(source);
  expect(environment).toEqual({ PATH: "/host/bin" });
  environment.PATH = "/different/bin";
  expect(source.PATH).toBe("/host/bin");
  expect(installerEnvironment({})).toEqual({});
});

test("frontend:install forwards operational settings through its shell and nested Bun installer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "strata-installer-env-"));
  try {
    const frontend = join(directory, "frontend");
    await mkdir(frontend);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        private: true,
        scripts: { "frontend:install": "cd frontend && bun install" },
      }),
    );
    await writeFile(
      join(frontend, "package.json"),
      JSON.stringify({ private: true, scripts: { postinstall: "bun capture-env.ts" } }),
    );
    await writeFile(
      join(frontend, "capture-env.ts"),
      `await Bun.write('installer-environment.json', JSON.stringify({
  proxy: process.env.HTTPS_PROXY,
  bypass: process.env.NO_PROXY,
  cache: process.env.BUN_INSTALL_CACHE_DIR,
  database: process.env.DATABASE_URL,
  secret: process.env.SESSION_SECRET,
  disableTLS: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
}));\n`,
    );
    const source = {
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      HOME: directory,
      TMPDIR: directory,
      HTTPS_PROXY: "http://proxy.invalid:8080",
      NO_PROXY: "localhost,127.0.0.1",
      BUN_INSTALL_CACHE_DIR: join(directory, "empty-cache"),
      DATABASE_URL: "postgres://must-not-inherit.invalid/shared",
      SESSION_SECRET: "must-not-inherit",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
    };
    const child = Bun.spawn([process.execPath, "run", "frontend:install"], {
      cwd: directory,
      env: installerEnvironment(source),
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10000,
    });
    const [code, output, errors] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, diagnostic: code === 0 ? "" : output + errors }).toEqual({
      code: 0,
      diagnostic: "",
    });
    expect(
      JSON.parse(await readFile(join(frontend, "installer-environment.json"), "utf8")),
    ).toEqual({
      proxy: source.HTTPS_PROXY,
      bypass: source.NO_PROXY,
      cache: source.BUN_INSTALL_CACHE_DIR,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
