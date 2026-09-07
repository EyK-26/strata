import { describe, expect, test } from "bun:test";
import {
  apiPrefix,
  appCookieName,
  appDevSecret,
  appDisplayName,
  appEnv,
  appKeyPrefix,
  appUrl,
  appUserAgent,
  namespacedRedisKey,
  otelServiceName,
  requireConfiguredSecret,
  sdkClientClassName,
  siemEventType,
  smtpEhloHost,
  webhookSignatureHeader,
} from "../../src/core/runtime/appKeyPrefix";
import { restoreEnvVar } from "../helpers/restoreEnv";

const IDENTITY_ENV = [
  "APP_KEY_PREFIX",
  "MAIL_EHLO",
  "SIEM_EVENT_TYPE",
  "APP_USER_AGENT",
  "OTEL_SERVICE_NAME",
  "WEBHOOK_SIGNATURE_HEADER",
  "APP_NAME",
] as const;

function snapshotIdentityEnv(): Record<(typeof IDENTITY_ENV)[number], string | undefined> {
  return {
    APP_KEY_PREFIX: process.env.APP_KEY_PREFIX,
    MAIL_EHLO: process.env.MAIL_EHLO,
    SIEM_EVENT_TYPE: process.env.SIEM_EVENT_TYPE,
    APP_USER_AGENT: process.env.APP_USER_AGENT,
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
    WEBHOOK_SIGNATURE_HEADER: process.env.WEBHOOK_SIGNATURE_HEADER,
    APP_NAME: process.env.APP_NAME,
  };
}

function restoreIdentityEnv(
  previous: Record<(typeof IDENTITY_ENV)[number], string | undefined>,
): void {
  for (const name of IDENTITY_ENV) {
    restoreEnvVar(name, previous[name]);
  }
}

function clearIdentityOverrides(): void {
  delete process.env.MAIL_EHLO;
  delete process.env.SIEM_EVENT_TYPE;
  delete process.env.APP_USER_AGENT;
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.WEBHOOK_SIGNATURE_HEADER;
}

describe("appKeyPrefix", () => {
  test("defaults to strata", () => {
    const previous = snapshotIdentityEnv();
    clearIdentityOverrides();
    delete process.env.APP_KEY_PREFIX;

    try {
      expect(appKeyPrefix()).toBe("strata");
      expect(appCookieName("session")).toBe("strata_session");
      expect(appCookieName("csrf")).toBe("strata_csrf");
      expect(appDevSecret("session-secret")).toBe("strata-dev-session-secret");
      expect(appDevSecret("token-pepper")).toBe("strata-dev-token-pepper");
      expect(namespacedRedisKey("cache:")).toBe("strata:cache:");
      expect(smtpEhloHost()).toBe("strata.local");
      expect(siemEventType()).toBe("strata.audit");
      expect(appUserAgent()).toBe("strata");
      expect(otelServiceName()).toBe("strata-api");
      expect(webhookSignatureHeader()).toBe("x-strata-signature");
    } finally {
      restoreIdentityEnv(previous);
    }
  });

  test("honors APP_KEY_PREFIX for isolated app keyspaces", () => {
    const previous = snapshotIdentityEnv();
    clearIdentityOverrides();
    process.env.APP_KEY_PREFIX = "forum";

    try {
      expect(appKeyPrefix()).toBe("forum");
      expect(appCookieName("session")).toBe("forum_session");
      expect(appCookieName("mfa_pending")).toBe("forum_mfa_pending");
      expect(appDevSecret("csrf-secret")).toBe("forum-dev-csrf-secret");
      expect(namespacedRedisKey("queue:default")).toBe("forum:queue:default");
      expect(smtpEhloHost()).toBe("forum.local");
      expect(siemEventType()).toBe("forum.audit");
      expect(appUserAgent()).toBe("forum");
      expect(otelServiceName()).toBe("forum-api");
      expect(webhookSignatureHeader()).toBe("x-forum-signature");
    } finally {
      restoreIdentityEnv(previous);
    }
  });

  test("honors explicit identity overrides and sanitizes EHLO hosts", () => {
    const previous = {
      MAIL_EHLO: process.env.MAIL_EHLO,
      SIEM_EVENT_TYPE: process.env.SIEM_EVENT_TYPE,
      APP_USER_AGENT: process.env.APP_USER_AGENT,
      OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME,
      WEBHOOK_SIGNATURE_HEADER: process.env.WEBHOOK_SIGNATURE_HEADER,
      APP_NAME: process.env.APP_NAME,
    };

    process.env.MAIL_EHLO = "mail.forum.test";
    process.env.SIEM_EVENT_TYPE = "forum.siem";
    process.env.APP_USER_AGENT = "ForumBot/1.0";
    process.env.OTEL_SERVICE_NAME = "forum-web";
    process.env.WEBHOOK_SIGNATURE_HEADER = "x-forum-hook";
    process.env.APP_NAME = "Forum";

    try {
      expect(smtpEhloHost()).toBe("mail.forum.test");
      expect(siemEventType()).toBe("forum.siem");
      expect(appUserAgent()).toBe("ForumBot/1.0");
      expect(otelServiceName()).toBe("forum-web");
      expect(webhookSignatureHeader()).toBe("x-forum-hook");
      expect(appDisplayName()).toBe("Forum");
    } finally {
      restoreEnvVar("MAIL_EHLO", previous.MAIL_EHLO);
      restoreEnvVar("SIEM_EVENT_TYPE", previous.SIEM_EVENT_TYPE);
      restoreEnvVar("APP_USER_AGENT", previous.APP_USER_AGENT);
      restoreEnvVar("OTEL_SERVICE_NAME", previous.OTEL_SERVICE_NAME);
      restoreEnvVar("WEBHOOK_SIGNATURE_HEADER", previous.WEBHOOK_SIGNATURE_HEADER);
      restoreEnvVar("APP_NAME", previous.APP_NAME);
    }
  });

  test("falls back to strata.local when MAIL_EHLO sanitizes to empty", () => {
    const previous = process.env.MAIL_EHLO;
    process.env.MAIL_EHLO = "!!!";

    try {
      expect(smtpEhloHost()).toBe("strata.local");
    } finally {
      restoreEnvVar("MAIL_EHLO", previous);
    }
  });

  test("defaults the display name to Strata", () => {
    const previous = process.env.APP_NAME;
    delete process.env.APP_NAME;

    try {
      expect(appDisplayName()).toBe("Strata");
    } finally {
      restoreEnvVar("APP_NAME", previous);
    }
  });

  test("resolves app URL, env, API prefix, and SDK class from env", () => {
    const previous = {
      APP_ENV: process.env.APP_ENV,
      APP_URL: process.env.APP_URL,
      API_PREFIX: process.env.API_PREFIX,
      APP_NAME: process.env.APP_NAME,
      APP_SDK_CLASS: process.env.APP_SDK_CLASS,
    };

    delete process.env.APP_ENV;
    delete process.env.APP_URL;
    delete process.env.API_PREFIX;
    delete process.env.APP_NAME;
    delete process.env.APP_SDK_CLASS;

    try {
      expect(appEnv()).toBe("local");
      expect(appUrl()).toBe("http://localhost:3000");
      expect(apiPrefix()).toBe("/api/v1");
      expect(sdkClientClassName()).toBe("StrataClient");

      process.env.APP_ENV = "production";
      process.env.APP_URL = "https://forum.test/";
      process.env.API_PREFIX = "api/v2/";
      process.env.APP_NAME = "Forum";
      expect(appEnv()).toBe("production");
      expect(appUrl()).toBe("https://forum.test");
      expect(apiPrefix()).toBe("/api/v2");
      expect(sdkClientClassName()).toBe("ForumClient");

      process.env.APP_SDK_CLASS = "ForumApi";
      expect(sdkClientClassName()).toBe("ForumApi");

      process.env.APP_SDK_CLASS = "123Bad";
      process.env.APP_NAME = "!!!";
      expect(sdkClientClassName()).toBe("AppClient");

      process.env.API_PREFIX = "///";
      expect(apiPrefix()).toBe("/api/v1");
    } finally {
      restoreEnvVar("APP_ENV", previous.APP_ENV);
      restoreEnvVar("APP_URL", previous.APP_URL);
      restoreEnvVar("API_PREFIX", previous.API_PREFIX);
      restoreEnvVar("APP_NAME", previous.APP_NAME);
      restoreEnvVar("APP_SDK_CLASS", previous.APP_SDK_CLASS);
    }
  });

  test("requireConfiguredSecret throws outside development and falls back locally", () => {
    expect(requireConfiguredSecret(["JWT_SECRET"], "jwt-secret", { APP_ENV: "local" })).toBe(
      "strata-dev-jwt-secret",
    );
    expect(
      requireConfiguredSecret(["JWT_SECRET"], "jwt-secret", {
        APP_ENV: "local",
        JWT_SECRET: " configured ",
      }),
    ).toBe("configured");
    expect(() =>
      requireConfiguredSecret(["JWT_SECRET"], "jwt-secret", { NODE_ENV: "production" }),
    ).toThrow(/JWT_SECRET must be set outside development/);
    expect(() =>
      requireConfiguredSecret(["JWT_SECRET"], "jwt-secret", { APP_ENV: "staging" }),
    ).toThrow(/JWT_SECRET must be set outside development/);
  });
});
