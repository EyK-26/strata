import assert from "node:assert/strict";

/** Assertions against the listening generated app, using its discovered module contexts. */
async function assertModuleCachedJson(
  origin: string,
  apiPrefix: string,
  headers: Record<string, string>,
): Promise<void> {
  for (const mode of ["api", "web"]) {
    const base = `${mode === "api" ? apiPrefix : ""}/qualification-cache/${mode}`;
    const read = (path: string, extra: Record<string, string> = {}) =>
      fetch(origin + base + path, {
        headers: { ...headers, ...extra },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
    for (const tagged of [false, true]) {
      const path = tagged ? "/tagged" : "/plain";
      const first = await read(path);
      assert.equal(first.status, 200);
      assert.match(first.headers.get("content-type") ?? "", /application\/json/);
      assert.deepEqual(await first.json(), { loads: 1 });
      assert.equal(first.headers.get("cache-control"), "private, must-revalidate");
      for (const vary of ["authorization", "x-tenant-id"]) {
        assert.ok(first.headers.get("vary")?.toLowerCase().includes(vary));
      }
      assert.ok(first.headers.get("x-request-id"));
      const etag = first.headers.get("etag");
      assert.ok(etag);
      const same = await read(path, { "if-none-match": etag });
      assert.equal(same.status, 304);
      assert.equal(await same.text(), "");
      assert.equal(same.headers.get("etag"), etag);
      const invalidated = await read(`${path}/invalidate`);
      assert.equal(invalidated.status, 200);
      assert.equal(await invalidated.json(), tagged ? 1 : true);
      const changed = await read(path, { "if-none-match": etag });
      assert.equal(changed.status, 200);
      assert.deepEqual(await changed.json(), { loads: 2 });
      assert.notEqual(changed.headers.get("etag"), etag);
    }
    const withoutRequest = await read("/without-request");
    assert.equal(withoutRequest.status, 200);
    assert.equal(await withoutRequest.json(), false);
    assert.equal(withoutRequest.headers.get("etag"), null);
    const failed = await read("/failure");
    assert.equal(failed.status, 500);
    await failed.text();
    const recovered = await read("/failure");
    assert.equal(recovered.status, 200);
    assert.deepEqual(await recovered.json(), { attempts: 2 });
  }
}

export { assertModuleCachedJson };
