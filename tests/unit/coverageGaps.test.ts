import { afterEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "@getstrata/core/auth/authContext";
import { membershipContext } from "@getstrata/core/auth/membershipContext";
import { assertOrganizationReadable } from "@getstrata/core/auth/membershipScope";
import { hashPassword, verifyPassword } from "@getstrata/core/auth/password";
import { Policy, PolicyGate } from "@getstrata/core/auth/policy";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionUserId,
} from "@getstrata/core/auth/sessionCookie";
import { hashApiToken } from "@getstrata/core/auth/tokenHash";
import {
  isFieldEncryptionEnabled,
  normalizeEmail,
  protectEmail,
  resolveEncryptionKey,
} from "@getstrata/core/crypto/fieldEncryption";
import { Factory } from "@getstrata/core/database/factory";
import { buildWhereClause } from "@getstrata/core/database/query";
import { EventBus } from "@getstrata/core/events";
import { Job } from "@getstrata/core/queue";
import { FailedJobService } from "@getstrata/core/queue/failedJobService";
import { JobRegistry } from "@getstrata/core/queue/jobRegistry";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "@getstrata/core/security/oauthState";
import { guestCanViewResource, isPublicReadsEnabled } from "@getstrata/core/security/publicReads";
import { assertSafeOutboundUrl, isBlockedHostname } from "@getstrata/core/security/safeUrl";
import { parseScimTenantTokens } from "@getstrata/core/security/scimTenantTokens";
import { logSecurityEvent } from "@getstrata/core/security/securityEvents";
import { verifyStripeWebhookSignature } from "@getstrata/core/security/stripeWebhook";
import {
  emailRule,
  enumRule,
  integerRange,
  integerRule,
  maxLength,
  minLength,
  pattern,
  positiveIntegerRule,
  stringRule,
} from "@getstrata/core/validation/rules";

class WidgetFactory extends Factory<{ name: string }> {
  protected override definition() {
    return { name: "widget" };
  }
}

class DefaultPolicy extends Policy {}

class CoverageJob extends Job<{ ok?: boolean }> {
  override async handle(): Promise<void> {}
}

describe("coverage gap helpers", () => {
  const originalAppEnv = process.env.APP_ENV;
  const originalFeatureEncryption = process.env.FEATURE_FIELD_ENCRYPTION;
  const originalTokenPepper = process.env.TOKEN_HASH_PEPPER;

  afterEach(() => {
    if (originalAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = originalAppEnv;
    }

    if (originalFeatureEncryption === undefined) {
      delete process.env.FEATURE_FIELD_ENCRYPTION;
    } else {
      process.env.FEATURE_FIELD_ENCRYPTION = originalFeatureEncryption;
    }

    if (originalTokenPepper === undefined) {
      delete process.env.TOKEN_HASH_PEPPER;
    } else {
      process.env.TOKEN_HASH_PEPPER = originalTokenPepper;
    }
  });

  test("covers base policy defaults and factory definitions", () => {
    const gate = new PolicyGate();
    gate.register("base", new DefaultPolicy());
    const basePolicy = new DefaultPolicy();

    expect(gate.allows("base", "view")).toBe(false);
    expect(gate.allows("base", "create")).toBe(false);
    expect(gate.allows("base", "update")).toBe(false);
    expect(gate.allows("base", "delete")).toBe(false);
    expect(basePolicy.create()).toBe(false);
    expect(basePolicy.delete()).toBe(false);
    expect(new WidgetFactory().make({ name: "custom" }).name).toBe("custom");
    expect(() => new (class extends Factory<{ value: number }> {})().make()).toThrow(
      "Factory definition must be implemented by subclass.",
    );
  });

  test("covers session cookie and oauth state edge branches", () => {
    const cookie = createSessionCookie(5);
    const request = new Request("http://example.test/", {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });

    expect(readSessionUserId(request)).toBe(5);
    expect(readSessionUserId(new Request("http://example.test/"))).toBeNull();
    expect(clearSessionCookie()).toContain("Max-Age=0");

    const decoded = decodeURIComponent(cookie.split("=")[1]?.split(";")[0] ?? "");
    const [userIdRaw, issuedAtRaw] = decoded.split(".");
    expect(
      readSessionUserId(
        new Request("http://example.test/", {
          headers: {
            cookie: `strata_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.`)}`,
          },
        }),
      ),
    ).toBeNull();

    const oauth = createOAuthStateCookie();
    expect(
      verifyOAuthState(
        new Request("http://example.test/", {
          headers: { cookie: `other=1; ${oauth.cookie}; another=2` },
        }),
        oauth.state,
      ),
    ).toBe(true);

    const originalNow = Date.now;
    Date.now = () => originalNow() + 11 * 60 * 1000;
    try {
      expect(
        verifyOAuthState(
          new Request("http://example.test/", {
            headers: { cookie: oauth.cookie.split(";")[0] ?? "" },
          }),
          oauth.state,
        ),
      ).toBe(false);
    } finally {
      Date.now = originalNow;
    }

    expect(
      verifyOAuthState(
        new Request("http://example.test/", {
          headers: { cookie: "oauth_state=only.two" },
        }),
        "only",
      ),
    ).toBe(false);

    expect(clearOAuthStateCookie()).toContain("Max-Age=0");
  });

  test("covers safe url, scim token parsing, and encryption helpers", () => {
    expect(isBlockedHostname("10.0.0.1")).toBe(true);
    expect(isBlockedHostname("172.20.0.1")).toBe(true);
    expect(isBlockedHostname("0.1.2.3")).toBe(true);
    expect(isBlockedHostname("8.8.8.8")).toBe(false);
    expect(() => assertSafeOutboundUrl("https://0.0.0.0/hook")).toThrow(/blocked host/);

    expect(parseScimTenantTokens("1:token-a,:bad,0:empty")).toEqual(new Map([[1, "token-a"]]));
    expect(parseScimTenantTokens("   ")).toEqual(new Map());
    expect(normalizeEmail("  A@B.COM ")).toBe("a@b.com");
    expect(hashApiToken("token")).toMatch(/^[a-f0-9]{64}$/);
    expect(isFieldEncryptionEnabled()).toBeTypeOf("boolean");
    expect(resolveEncryptionKey()).toBeNull();
    expect(protectEmail("plain@example.com").storedEmail).toBe("plain@example.com");
  });

  test("covers validation rule branches and query null equality", () => {
    expect(stringRule()("name", 1, {})).toContain("must be a string");
    expect(maxLength(2)("name", "abc", {})).toContain("at most 2");
    expect(integerRule()("count", "x", {})).toContain("must be an integer");
    expect(integerRange(1, 3)("count", 9, {})).toContain("between 1 and 3");
    expect(integerRange(1, 3)("count", "", {})).toBeUndefined();
    expect(positiveIntegerRule()("count", "", {})).toBeUndefined();
    expect(pattern(/^[a-z]+$/)("slug", 42, {})).toBeUndefined();

    const { clause: nullClause } = buildWhereClause("task", {
      status: { eq: null },
    });
    expect(nullClause).toContain("IS NULL");

    const { clause: valueClause } = buildWhereClause("task", {
      status: { eq: "active" },
    });
    expect(valueClause).toContain("=");
  });

  test("covers event bus cleanup and job registry names", async () => {
    const bus = new EventBus();
    let firstCount = 0;
    let secondCount = 0;
    const unsubscribeFirst = bus.listen("shared.event", () => {
      firstCount += 1;
    });
    bus.listen("shared.event", () => {
      secondCount += 1;
    });
    unsubscribeFirst();
    await bus.dispatch("shared.event", {});
    expect(firstCount).toBe(0);
    expect(secondCount).toBe(1);

    const unsubscribe = bus.listen("once.event", () => undefined);
    unsubscribe();

    const registry = new JobRegistry();
    registry.register("demo.job", () => new CoverageJob());
    expect(registry.names()).toEqual(["demo.job"]);
    expect(registry.create("missing.job")).toBeUndefined();

    const { jobRegistry } = await import("@getstrata/core/queue/jobRegistry");
    const { registerDefaultJobs } = await import("@getstrata/bootstrap/queue/defaultJobs");
    registerDefaultJobs();
    const job = new CoverageJob();
    jobRegistry.track("coverage.job", job);
    expect(jobRegistry.resolveName(job)).toBe("coverage.job");
  });

  test("covers stripe webhook signature length mismatch", () => {
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"type":"invoice.paid"}';

    expect(() => verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=short`, secret)).toThrow(
      /Invalid Stripe webhook signature/,
    );
  });

  test("covers failed job service listRecent default limit", async () => {
    const service = new FailedJobService({
      findAll: async () => [],
      findByIdOrThrow: async (_id: number, onMissing: (id: number) => Error) => {
        throw onMissing(404);
      },
    } as never);

    await expect(service.listRecent()).resolves.toEqual([]);
    await expect(service.retry(404)).rejects.toThrow("Failed job 404 not found.");
  });

  test("covers membership scope organization readable early return for admins", () => {
    runWithAuthUser({ id: 1, role: "admin" }, () => {
      membershipContext.run(
        {
          organizationIds: [1],
          rolesByOrganizationId: new Map([[1, "member"]]),
        },
        () => {
          expect(() => assertOrganizationReadable(999)).not.toThrow();
        },
      );
    });
  });

  test("covers remaining security, queue, and policy branches", async () => {
    const { eventBus } = await import("@getstrata/core/events/eventBus");
    let singletonCount = 0;
    const unsubscribe = eventBus.listen("singleton.event", () => {
      singletonCount += 1;
    });
    await eventBus.dispatch("singleton.event", {});
    unsubscribe();
    expect(singletonCount).toBe(1);
    await expect(eventBus.dispatch("unused.event", {})).resolves.toBeUndefined();

    const failedService = new FailedJobService({
      create: async (input: {
        jobName: string;
        payload: Record<string, unknown>;
        exception: string;
      }) => ({ id: 1, ...input }),
    } as never);
    await expect(
      failedService.recordFailure({ jobName: "demo", payload: {}, exception: "x" }),
    ).resolves.toMatchObject({ job_name: "demo" });

    expect(new DefaultPolicy().view()).toBe(false);
    expect(new DefaultPolicy().update()).toBe(false);

    expect(enumRule(["a"])("field", 1, {})).toBeUndefined();
    expect(enumRule(["a"])("field", "a", {})).toBeUndefined();
    expect(emailRule()("field", 1, {})).toBeUndefined();
    expect(integerRule()("field", "", {})).toBeUndefined();
    expect(stringRule()("name", null, {})).toBeUndefined();
    expect(minLength(2)("name", 1, {})).toBeUndefined();
    expect(maxLength(2)("name", 1, {})).toBeUndefined();
    expect(integerRange(1, 3)("count", 2, {})).toBeUndefined();
    expect(positiveIntegerRule()("count", 3, {})).toBeUndefined();

    expect(isPublicReadsEnabled()).toBeTypeOf("boolean");
    expect(guestCanViewResource()).toBe(isPublicReadsEnabled());
    logSecurityEvent("coverage.ping", { ok: true });

    const hashed = await hashPassword("password");
    expect(hashed.length).toBeGreaterThan(10);
    expect(await verifyPassword("password", hashed)).toBe(true);
    expect(await verifyPassword("nope", hashed)).toBe(false);

    expect(isBlockedHostname("999.999.999.999")).toBe(true);
    expect(isBlockedHostname("127.0.0.2")).toBe(true);

    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    expect(isFieldEncryptionEnabled()).toBe(true);
  });
});
