import { expect, test } from "bun:test";
import type { CommandScope } from "@getstrata/core/contracts/application";
import { resourceService, service, valueService } from "@getstrata/core/contracts/services";
import { createServiceToken, isServiceToken } from "@getstrata/core/contracts/token";
import { createApplication } from "@getstrata/core/runtime/application";

test("ordinary service payloads with noncallable then data retain identity", async () => {
  const Token = createServiceToken<{ then: number; label: string }>("ordinary.then.data");
  // biome-ignore lint/suspicious/noThenProperty: Noncallable data is deliberately a valid payload.
  const payload = { then: 3, label: "ordinary data" };
  const app = createApplication({ providers: [], services: [valueService(Token, payload)] });
  try {
    await app.start();
    expect(await app.run((scope) => scope.resolve(Token))).toBe(payload);
    expect(Object.isFrozen(payload)).toBe(false);
  } finally {
    await app.stop();
  }
});

test("invalid factory options and graph declarations fail before resources are acquired", () => {
  const Token = createServiceToken<number>("invalid.factory");
  const Resource = createServiceToken<object>("unopened.resource");
  const Missing = createServiceToken<number>("missing.dependency");
  let acquired = 0;
  const owned = resourceService(Resource, {
    lifetime: "application",
    dependencies: [],
    create: () => ({
      name: "unopened",
      open: () => {
        acquired++;
        return { ok: true, value: {} };
      },
      close() {},
    }),
  });
  const create = () => {
    acquired++;
    return 1;
  };
  for (const options of [
    { lifetime: "request", dependencies: [], create },
    { lifetime: "application", dependencies: null, create },
    { lifetime: "application", dependencies: [], create: 1 },
  ])
    expect(() => service(Token, options as never)).toThrow(TypeError);
  const valid = service(Token, { lifetime: "application", dependencies: [], create });
  for (const declarations of [
    [owned, { ...valid, dependencies: null }],
    [owned, { ...valid, create: null }],
    [owned, valid, valid],
    [owned, service(Token, { lifetime: "application", dependencies: [Missing], create })],
  ])
    expect(() => createApplication({ providers: [], services: declarations as never })).toThrow();
  expect(acquired).toBe(0);
});

test("revoked and reflection-throwing token proxies fail validation without leaking proxy errors", () => {
  const original = createServiceToken<number>("proxy.token");
  const revoked = Proxy.revocable(original, {});
  revoked.revoke();
  const opaque = new Proxy(original, {
    getPrototypeOf() {
      throw new Error("private proxy failure");
    },
  });
  for (const token of [revoked.proxy, opaque]) {
    expect(isServiceToken(token)).toBe(false);
    expect(() => valueService(token, 1)).toThrow("Expected an opaque service token");
  }
});

test("opaque callback results use native normalization and expire the command scope", async () => {
  const app = createApplication({ providers: [] });
  const Missing = createServiceToken<number>("expired.scope");
  const reflected = new Error("opaque descriptor visibility");
  const payload = new Proxy(
    { label: "opaque result" },
    {
      getOwnPropertyDescriptor() {
        throw reflected;
      },
    },
  );
  let retained: CommandScope | undefined;
  try {
    await app.start();
    const result = await app.run((scope) => {
      retained = scope;
      return payload;
    });
    expect(result).toBe(payload);
    expect(result.label).toBe("opaque result");
    if (!retained) throw new Error("Command scope was not entered.");
    const expired = retained;
    expect(() => expired.resolve(Missing)).toThrow("APPLICATION_SCOPE_EXPIRED");
  } finally {
    await app.stop();
  }
});
