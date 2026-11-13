import { describe, expect, test } from "bun:test";
import type { ServiceContainer } from "@getstrata/bootstrap/contracts";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { CORE_AUTH_USER_DIRECTORY_TOKEN } from "@getstrata/core/contracts/serviceTokens";
import { resolveWebLayoutData } from "@getstrata/core/view/webLayoutData";

describe("resolveWebLayoutData", () => {
  test("returns null auth user when there is no session", async () => {
    const container = {
      has: () => false,
      resolve: () => {
        throw new Error("should not resolve");
      },
    } as unknown as ServiceContainer;

    const data = await resolveWebLayoutData(container);

    expect(data.authUser).toBeNull();
  });

  test("returns email for the authenticated session user", async () => {
    const container = {
      has: (token: unknown) => token === CORE_AUTH_USER_DIRECTORY_TOKEN,
      resolve: () => ({
        findByIdOrThrow: async (id: number) => ({
          id,
          email: "admin@hiroapp.com",
          role: "admin",
        }),
      }),
    } as unknown as ServiceContainer;

    const data = await runWithAuthUser({ id: 7, role: "admin", abilities: ["*"] }, async () =>
      resolveWebLayoutData(container),
    );

    expect(data.authUser).toEqual({
      id: 7,
      email: "admin@hiroapp.com",
      role: "admin",
    });
  });

  test("loadUser receives the current Request", async () => {
    const request = new Request("http://example.test/forum?page=2", {
      headers: { cookie: "strata_session=abc" },
    });
    let seen: Request | undefined;
    const options = {
      userKey: "currentUser" as const,
      loadUser: async (_container: unknown, incoming: Request | undefined) => {
        seen = incoming;
        return { id: 3, email: "member@example.test", role: "member" };
      },
    };

    const container = {
      has: () => false,
      resolve: () => {
        throw new Error("should not resolve");
      },
    } as unknown as ServiceContainer;

    const data = await resolveWebLayoutData(container, request, options);

    expect(seen).toBe(request);
    expect(data.currentUser).toEqual({
      id: 3,
      email: "member@example.test",
      role: "member",
    });
    expect(data.cspNonce).toBe("");
  });
});

test("captured cookie policies preserve owner tokens and reject another owner's flash", async () => {
  const { csrfTokenOptionsFromEnvironment, createCsrfTokenCookie } = await import(
    "@getstrata/core/http/csrfToken"
  );
  const { flashSessionOptionsFromEnvironment, createFlashCookie } = await import(
    "@getstrata/core/http/flashSession"
  );
  const { createWebLayoutDataResolver } = await import("@getstrata/core/view/webLayoutData");
  const env = {
    APP_ENV: "development",
    APP_KEY_PREFIX: "first",
    SESSION_SECRET: "first-owner-secret",
  };
  const csrf = csrfTokenOptionsFromEnvironment(env);
  const flash = flashSessionOptionsFromEnvironment(env);
  const first = createCsrfTokenCookie(csrf);
  const request = new Request("https://app.test/form", {
    headers: {
      cookie: `${first.cookie.split(";")[0]}; ${createFlashCookie({ level: "info", message: "first-only" }, flash).split(";")[0]}`,
    },
  });
  const container = {
    has: () => false,
    resolve: () => {
      throw new Error("unused");
    },
  } as unknown as ServiceContainer;
  const options = { csrf: { ...csrf }, flash: { ...flash } };
  const resolveFirst = createWebLayoutDataResolver(container, options);
  options.csrf.secret = "mutated";
  options.flash.secret = "mutated";
  const resolveSecond = createWebLayoutDataResolver(container, {
    csrf: csrfTokenOptionsFromEnvironment({
      ...env,
      APP_KEY_PREFIX: "second",
      SESSION_SECRET: "second-owner-secret",
    }),
    flash: flashSessionOptionsFromEnvironment({
      ...env,
      APP_KEY_PREFIX: "second",
      SESSION_SECRET: "second-owner-secret",
    }),
  });
  const [firstData, secondData, ownerless] = await Promise.all([
    resolveFirst(request),
    resolveSecond(request),
    resolveWebLayoutData(container, request),
  ]);
  expect(firstData.csrfToken).toBe(first.token);
  expect(firstData.flash).toEqual({ level: "info", message: "first-only" });
  expect(secondData.csrfToken).not.toBe(first.token);
  expect(secondData.flash).toBeNull();
  expect(ownerless.csrfToken).toBe("");
  expect(ownerless.flash).toBeNull();
});

test("explicit request cannot borrow CSRF, flash, or nonce from another request context", async () => {
  const { csrfTokenOptionsFromEnvironment, createCsrfTokenCookie } = await import(
    "@getstrata/core/http/csrfToken"
  );
  const { runWithRequestMeta } = await import("@getstrata/core/http/requestMetaContext");
  const { createWebLayoutDataResolver } = await import("@getstrata/core/view/webLayoutData");
  const csrf = csrfTokenOptionsFromEnvironment({
    APP_ENV: "development",
    SESSION_SECRET: "shared-explicit-policy",
  });
  const proofA = createCsrfTokenCookie(csrf);
  const proofB = createCsrfTokenCookie(csrf);
  const requestA = new Request("https://app.test/a", {
    headers: { cookie: proofA.cookie.split(";")[0] ?? "" },
  });
  const requestB = new Request("https://app.test/b", {
    headers: { cookie: proofB.cookie.split(";")[0] ?? "" },
  });
  const container = {
    has: () => false,
    resolve: () => {
      throw new Error("unused");
    },
  } as unknown as ServiceContainer;
  const resolve = createWebLayoutDataResolver(container, { csrf });
  await runWithRequestMeta(
    {
      ipAddress: null,
      userAgent: null,
      request: requestB,
      csrfToken: proofB.token,
      cspNonce: "nonce-b",
      flash: { level: "info", message: "only-b" },
    },
    async () => {
      const [explicitA, sameB] = await Promise.all([resolve(requestA), resolve(requestB)]);
      expect(explicitA.csrfToken).toBe(proofA.token);
      expect(explicitA.csrfToken).not.toBe(proofB.token);
      expect(explicitA.cspNonce).toBe("");
      expect(explicitA.flash).toBeNull();
      expect(sameB.csrfToken).toBe(proofB.token);
      expect(sameB.cspNonce).toBe("nonce-b");
      expect(sameB.flash).toEqual({ level: "info", message: "only-b" });
    },
  );
});
