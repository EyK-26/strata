import { afterEach, describe, expect, test } from "bun:test";
import { runWithAuthUser } from "../../src/core/auth/authContext";
import { membershipContext } from "../../src/core/auth/membershipContext";
import { assertOrganizationReadable } from "../../src/core/auth/membershipScope";
import { Policy, PolicyGate } from "../../src/core/auth/policy";
import {
  clearSessionCookie,
  createSessionCookie,
  readSessionUserId,
} from "../../src/core/auth/sessionCookie";
import { hashApiToken } from "../../src/core/auth/tokenHash";
import {
  isFieldEncryptionEnabled,
  normalizeEmail,
  protectEmail,
  resolveEncryptionKey,
} from "../../src/core/crypto/fieldEncryption";
import { Factory } from "../../src/core/database/factory";
import { buildWhereClause } from "../../src/core/database/query";
import { EventBus } from "../../src/core/events/eventBus";
import DispatchWebhookJob from "../../src/core/jobs/dispatchWebhookJob";
import FailedJobService from "../../src/core/queue/failedJobService";
import { JobRegistry } from "../../src/core/queue/jobRegistry";
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  verifyOAuthState,
} from "../../src/core/security/oauthState";
import { assertSafeOutboundUrl, isBlockedHostname } from "../../src/core/security/safeUrl";
import { parseScimTenantTokens } from "../../src/core/security/scimTenantTokens";
import { verifyStripeWebhookSignature } from "../../src/core/security/stripeWebhook";
import {
  emailRule,
  enumRule,
  integerRange,
  integerRule,
  maxLength,
  pattern,
  positiveIntegerRule,
  stringRule,
} from "../../src/core/validation/rules";
import AttachmentPolicy from "../../src/modules/attachment/policy";
import BillingService from "../../src/modules/billing/service";
import CommentPolicy from "../../src/modules/comment/policy";
import CommentRepository from "../../src/modules/comment/repository";
import OrganizationPolicy from "../../src/modules/organization/policy";
import ProjectPolicy from "../../src/modules/project/policy";
import SearchService from "../../src/modules/search/service";
import TaskPolicy from "../../src/modules/task/policy";
import TaskRepository from "../../src/modules/task/repository";
import NotificationService from "../../src/modules/user/notificationService";
import TokenService from "../../src/modules/user/tokenService";

class WidgetFactory extends Factory<{ name: string }> {
  protected override definition() {
    return { name: "widget" };
  }
}

class DefaultPolicy extends Policy {}

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
            cookie: `workhub_session=${encodeURIComponent(`${userIdRaw}.${issuedAtRaw}.`)}`,
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

  test("covers event bus cleanup, job registry names, and webhook job metadata", async () => {
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
    registry.register("demo.job", () => new DispatchWebhookJob());
    expect(registry.names()).toEqual(["demo.job"]);
    expect(registry.create("missing.job")).toBeUndefined();

    const { jobRegistry } = await import("../../src/core/queue/jobRegistry");
    const { registerDefaultJobs } = await import("../../src/bootstrap/queue/defaultJobs");
    registerDefaultJobs();
    expect(jobRegistry.create("webhook.dispatch")).toBeInstanceOf(DispatchWebhookJob);

    const job = new DispatchWebhookJob();
    expect(job.maxAttempts).toBe(3);
    expect(job.backoffMs).toBe(2_000);
  });

  test("covers stripe webhook signature length mismatch", () => {
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = '{"type":"invoice.paid"}';

    expect(() => verifyStripeWebhookSignature(rawBody, `t=${timestamp},v1=short`, secret)).toThrow(
      /Invalid Stripe webhook signature/,
    );
  });

  test("covers policy update branches for module policies", () => {
    const attachmentPolicy = new AttachmentPolicy();
    expect(attachmentPolicy.update({ id: 1, role: "admin" }, { organization_id: 5 } as never)).toBe(
      false,
    );

    const attachmentGate = new PolicyGate();
    attachmentGate.register("attachment", attachmentPolicy);
    expect(attachmentGate.allows("attachment", "update", { id: 1, role: "admin" })).toBe(false);

    const commentGate = new PolicyGate();
    commentGate.register("comment", new CommentPolicy());
    expect(commentGate.allows("comment", "update", null)).toBe(false);

    const projectGate = new PolicyGate();
    projectGate.register("project", new ProjectPolicy());
    expect(projectGate.allows("project", "update", null)).toBe(false);

    const taskGate = new PolicyGate();
    taskGate.register("task", new TaskPolicy());
    expect(taskGate.allows("task", "update", null)).toBe(false);

    const organizationGate = new PolicyGate();
    organizationGate.register("organization", new OrganizationPolicy());
    expect(organizationGate.allows("organization", "update", null)).toBe(false);
  });

  test("covers token, notification, billing, and search service branches", async () => {
    const tokenService = new TokenService(
      {
        findByIdOrThrow: async (id: number) => ({ id, role: "member", email: "a@b.com" }),
        findById: async () => null,
      } as never,
      {
        findByTokenHash: async () => ({
          id: 1,
          user_id: 2,
          abilities: ["*"],
          expires_at: null,
        }),
        touchLastUsedAt: async () => undefined,
      } as never,
    );

    expect(await tokenService.resolveUserFromToken("plain-token")).toBeNull();
    await expect(tokenService.findByIdOrThrow(9)).resolves.toMatchObject({ id: 9 });

    const revokeService = new TokenService(
      { findByIdOrThrow: async () => ({ id: 1 }) } as never,
      {
        findById: async () => ({ id: 1, user_id: 2 }),
        deleteById: async () => false,
      } as never,
    );

    await expect(revokeService.revokeToken(1, 1)).rejects.toThrow("API token 1 not found.");

    const notificationService = new NotificationService({
      findByIdOrThrow: async (_id: number, onMissing: (id: number) => Error) => {
        throw onMissing(1);
      },
    } as never);
    await expect(notificationService.markRead(1, 1)).rejects.toThrow("Notification 1 not found.");

    const billingService = new BillingService();
    await expect(billingService.getSubscriptionForTenant(999_999)).resolves.toBeNull();

    const searchService = new SearchService(new TaskRepository(), new CommentRepository());
    await expect(searchService.search("no-match-query-xyz", 5)).resolves.toEqual([]);
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

  test("covers organization policy delete branch for missing users", () => {
    const gate = new PolicyGate();
    gate.register("organization", new OrganizationPolicy());

    expect(
      gate.allows("organization", "delete", null, {
        id: 1,
        slug: "regular-org",
      } as never),
    ).toBe(false);
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

  test("covers remaining security, queue, and module policy branches", async () => {
    const { eventBus } = await import("../../src/core/events/eventBus");
    let singletonCount = 0;
    const unsubscribe = eventBus.listen("singleton.event", () => {
      singletonCount += 1;
    });
    await eventBus.dispatch("singleton.event", {});
    unsubscribe();
    expect(singletonCount).toBe(1);
    await expect(eventBus.dispatch("unused.event", {})).resolves.toBeUndefined();

    const registry = new JobRegistry();
    const job = new DispatchWebhookJob();
    registry.track("tracked.job", job);
    expect(registry.resolveName(job)).toBe("tracked.job");

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
    expect(emailRule()("field", 1, {})).toBeUndefined();
    expect(integerRule()("field", "", {})).toBeUndefined();

    expect(isBlockedHostname("999.999.999.999")).toBe(true);
    expect(isBlockedHostname("127.0.0.2")).toBe(true);

    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    expect(isFieldEncryptionEnabled()).toBe(true);
  });
});
