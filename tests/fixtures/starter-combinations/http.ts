import assert from "node:assert/strict";
import { readdir, rename } from "node:fs/promises";
import { resolve } from "node:path";

const appDir = process.cwd();
const { bootstrapApp, createAppServer } = await import(
  resolve(appDir, "src/bootstrap/createApp.ts")
);
const { closeDatabase } = await import(resolve(appDir, "src/bootstrap/database.ts"));
const app = await bootstrapApp({ migrate: false });
const server = createAppServer(app.routes, 0, undefined, { hostname: "127.0.0.1" });
const output = console.log.bind(console);
const completions: Array<{ message: string; path: string; requestId: string }> = [];
console.log = (...values) => {
  if (typeof values[0] === "string") {
    try {
      const row = JSON.parse(values[0]);
      if (row.message === "HTTP request completed") completions.push(row);
    } catch {
      /* Observe only the real logger's JSON lines. */
    }
  }
  output(...values);
};
let checks = 0;
async function probe(path: string, expected: number, supplied?: string) {
  const before = completions.length;
  const response = await fetch(new URL(path, server.url), {
    headers: supplied ? { "x-request-id": supplied } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.text();
  assert.equal(response.status, expected, body);
  for (const header of [
    "content-security-policy",
    "x-frame-options",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
  ])
    assert.ok(response.headers.get(header), header);
  const id = response.headers.get("x-request-id");
  assert.ok(id);
  if (supplied) assert.equal(id, supplied);
  const logs = completions.slice(before);
  assert.equal(logs.length, 1, "Exactly one final response observation");
  assert.equal(logs[0]?.requestId, id);
  checks++;
  return body;
}
try {
  await probe("/api/v1/auth/me", 401);
  await probe("/api/v1/auth/me", 401, "owned-http-correlation");
  if (process.env.FRONTEND_MODE === "hybrid") await probe("/login", 200);
  assert.match(await probe("/console/", 200), /<html/);
  assert.match(await probe("/console/orders", 200), /<html/);
  const asset = (await readdir(resolve(appDir, "frontend/dist"))).find((name) =>
    name.endsWith(".js"),
  );
  assert.ok(asset, "Real build must produce a JavaScript asset");
  assert.ok((await probe(`/console/${asset}`, 200)).length > 0);
  const index = resolve(appDir, "frontend/dist/index.html"),
    hidden = `${index}.owned-probe-hidden`;
  await rename(index, hidden);
  try {
    await probe("/console/", 503);
  } finally {
    await rename(hidden, index);
  }
  const start = completions.length;
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, (_, i) => fetch(new URL(`/api/v1/auth/me?case=${i}`, server.url))),
  );
  const ids = concurrent.map((response) => response.headers.get("x-request-id"));
  await Promise.all(concurrent.map((response) => response.text()));
  assert.equal(new Set(ids).size, 4);
  assert.deepEqual(new Set(completions.slice(start).map((log) => log.requestId)), new Set(ids));
  console.log(
    JSON.stringify({
      checks,
      concurrent: 4,
      frontend: process.env.FRONTEND_MODE,
      consumer: "http-policy-and-correlation",
    }),
  );
} finally {
  console.log = output;
  server.stop(true);
  await app.context.dispose();
  await closeDatabase();
}
