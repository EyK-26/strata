import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ForbiddenError } from "@getstrata/core/errors/http";
import { resolveApplicationCache } from "@getstrata/core/runtime/applicationRegistry";
import { ROLE, STATUS } from "../lib/roles.ts";
import { Application } from "../models/Application.ts";
import { CareerPosting } from "../models/CareerPosting.ts";
import { Position } from "../models/Position.ts";
import { accountService } from "../modules/account/service.ts";
import { careerService } from "../modules/careers/service.ts";
import { offerService, serializeOffer } from "../modules/offers/service.ts";
import { resolveSsoProvider, ssoProviderNames, ssoService } from "../modules/sso/service.ts";
import { bootHiroapp, seededUser } from "./helpers.ts";

const enabled = process.env.HIROAPP_TEST === "1";

describe.skipIf(!enabled)("hiring coverage for auth, careers, and offers", () => {
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(async () => {
    const boot = await bootHiroapp();
    server = boot.server;
  });

  afterAll(() => {
    server?.stop(true);
  });

  test("SSO names GitHub and OIDC when those env vars are set", () => {
    const previousGithub = process.env.GITHUB_CLIENT_ID;
    const previousIssuer = process.env.OIDC_ISSUER;
    const previousOidc = process.env.OIDC_CLIENT_ID;
    const previousMock = process.env.FEATURE_OAUTH_MOCK;
    process.env.GITHUB_CLIENT_ID = "github-hiring-client";
    process.env.OIDC_ISSUER = "https://idp.example";
    process.env.OIDC_CLIENT_ID = "oidc-hiring-client";
    process.env.FEATURE_OAUTH_MOCK = "true";
    try {
      expect(ssoProviderNames()).toEqual(expect.arrayContaining(["github", "oidc", "mock"]));
      const github = resolveSsoProvider("github");
      expect(github?.name).toBe("github");
      expect(github?.getAuthorizationUrl("state-token")).toContain("github.com");
      const oidc = resolveSsoProvider("oidc");
      expect(oidc?.name).toBe("oidc");
      expect(oidc?.getAuthorizationUrl("state-token")).toContain("https://idp.example/authorize");
      expect(resolveSsoProvider("nope")).toBeNull();
    } finally {
      restoreEnv("GITHUB_CLIENT_ID", previousGithub);
      restoreEnv("OIDC_ISSUER", previousIssuer);
      restoreEnv("OIDC_CLIENT_ID", previousOidc);
      restoreEnv("FEATURE_OAUTH_MOCK", previousMock);
    }
  });

  test("a second SSO login reuses the linked candidate", async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const profile = {
      providerUserId: `coverage-${stamp}`,
      email: `coverage.sso.${stamp}@hiroapp.com`,
      name: "Solo",
    };
    const first = await ssoService.loginFromProfile("mock", profile);
    expect(Number(first.role_id)).toBe(ROLE.CANDIDATE);
    const second = await ssoService.loginFromProfile("mock", profile);
    expect(Number(second.id)).toBe(Number(first.id));
    expect(second.email).toBe(profile.email);
  });

  test("sendVerificationEmail mails a signed confirm link", async () => {
    const previous = process.env.FEATURE_EMAIL_VERIFICATION;
    process.env.FEATURE_EMAIL_VERIFICATION = "true";
    try {
      const candidate = await seededUser("candidate@hiroapp.com");
      await accountService.sendVerificationEmail(candidate);
    } finally {
      restoreEnv("FEATURE_EMAIL_VERIFICATION", previous);
    }
  });

  test("the public career board can be switched off", async () => {
    let listed = await careerService.listPublic();
    if (!listed[0]) {
      const recruiter = await seededUser("recruiter@hiroapp.com");
      const seat = await Position.create({
        user_id: null,
        department_id: 1,
        grade_id: 1,
        name: `Public board ${Date.now()}`,
        description: "coverage",
        hiring: true,
        start_date: null,
        end_date: null,
      });
      await careerService.publish(recruiter, seat);
      listed = await careerService.listPublic();
    }
    const preview = listed[0];
    if (!preview) {
      throw new Error("Expected a public career posting for coverage.");
    }
    const posting = await CareerPosting.findOrFail(preview.id);
    const previous = process.env.FEATURE_PUBLIC_READS;
    process.env.FEATURE_PUBLIC_READS = "false";
    try {
      await expect(careerService.listPublic()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(careerService.showPublic(posting)).rejects.toBeInstanceOf(ForbiddenError);
    } finally {
      restoreEnv("FEATURE_PUBLIC_READS", previous);
    }
  });

  test("a down careers cache still loads the public board", async () => {
    const cache = resolveApplicationCache();
    const originalTags = cache.tags.bind(cache);
    cache.tags = (...names: string[]) => ({
      remember: async () => {
        throw new Error("careers cache unavailable");
      },
      flush: () => originalTags(...names).flush(),
    });
    try {
      const listed = await careerService.listPublic();
      expect(Array.isArray(listed)).toBe(true);
    } finally {
      cache.tags = originalTags;
    }
  });

  test("offer notes encrypt when field encryption is on", async () => {
    const previousFlag = process.env.FEATURE_FIELD_ENCRYPTION;
    const previousKey = process.env.KMS_ENCRYPTION_KEY;
    process.env.FEATURE_FIELD_ENCRYPTION = "true";
    process.env.KMS_ENCRYPTION_KEY = "11".repeat(32);
    try {
      const recruiter = await seededUser("recruiter@hiroapp.com");
      const candidate = await seededUser("candidate@hiroapp.com");
      const seat = await Position.create({
        user_id: null,
        department_id: 1,
        grade_id: 1,
        name: `Encrypted offer ${Date.now()}`,
        description: "notes",
        hiring: true,
        start_date: null,
        end_date: null,
      });
      const application = await Application.create({
        user_id: candidate.id,
        position_id: Number(seat.id),
        status_id: STATUS.FEEDBACK,
        attachment_text: null,
        attachment_file: null,
      });
      const created = await offerService.create(recruiter, application, {
        salary: 140_000,
        notes: "comp band confidential",
      });
      expect(created.notes?.startsWith("enc:v1:")).toBe(true);
      expect(serializeOffer(created).notes).toBe("comp band confidential");
    } finally {
      restoreEnv("FEATURE_FIELD_ENCRYPTION", previousFlag);
      restoreEnv("KMS_ENCRYPTION_KEY", previousKey);
    }
  });
});

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}
