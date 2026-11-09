import { test } from "bun:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerProxyCaBuildArgs } from "../../scripts/docker-build-proxy-ca";

test("Docker CA trust is opt-in and preserves the default no-secret build", () => {
  assert.deepEqual(dockerProxyCaBuildArgs({}), []);
});

test("Docker CA trust forwards only a readable regular file as a BuildKit secret", () => {
  const directory = mkdtempSync(join(tmpdir(), "strata-docker-ca-"));
  try {
    const ca = join(directory, "proxy ca.crt");
    writeFileSync(ca, "fixture CA certificate");
    assert.deepEqual(dockerProxyCaBuildArgs({ STRATA_DOCKER_PROXY_CA: ca }), [
      "--secret",
      `id=proxy_ca,src=${ca}`,
    ]);
    const quoted = join(directory, 'proxy,"ca.crt');
    writeFileSync(quoted, "fixture CA certificate");
    assert.deepEqual(dockerProxyCaBuildArgs({ STRATA_DOCKER_PROXY_CA: quoted }), [
      "--secret",
      `id=proxy_ca,"src=${quoted.replaceAll('"', '""')}"`,
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid supplied Docker CA paths fail clearly without leaking their values", () => {
  const directory = mkdtempSync(join(tmpdir(), "strata-docker-ca-"));
  try {
    for (const value of ["", " ", directory, join(directory, "private-missing-name.crt")]) {
      assert.throws(() => dockerProxyCaBuildArgs({ STRATA_DOCKER_PROXY_CA: value }), {
        message: "STRATA_DOCKER_PROXY_CA must name a readable regular CA file.",
      });
    }
    const unreadable = join(directory, "unreadable.crt");
    writeFileSync(unreadable, "fixture CA certificate");
    chmodSync(unreadable, 0);
    try {
      assert.throws(() => dockerProxyCaBuildArgs({ STRATA_DOCKER_PROXY_CA: unreadable }), {
        message: "STRATA_DOCKER_PROXY_CA must name a readable regular CA file.",
      });
    } finally {
      chmodSync(unreadable, 0o600);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
