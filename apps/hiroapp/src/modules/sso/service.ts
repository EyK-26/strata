import { randomBytes } from "node:crypto";
import { OidcProvider } from "@getstrata/core/auth/oauth/oidcProvider";
import { GitHubOAuthProvider, MockOAuthProvider } from "@getstrata/core/auth/oauth/providers";
import type { OAuthProfile, OAuthProvider } from "@getstrata/core/auth/oauth/types";
import { hashPassword } from "@getstrata/core/auth/password";
import { currentTenantId } from "@getstrata/core/tenant/tenantContext";
import { ROLE } from "../../lib/roles.ts";
import { users } from "../users/repository.ts";
import type { UserRecord } from "../users/table.ts";
import { oauthIdentities } from "./repository.ts";

function splitName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] ?? "Hiring",
    last_name: parts.slice(1).join(" ") || "Candidate",
  };
}

function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function ssoProviderNames(): string[] {
  const names: string[] = [];
  if (process.env.GITHUB_CLIENT_ID?.trim()) {
    names.push("github");
  }
  if (process.env.OIDC_ISSUER?.trim() && process.env.OIDC_CLIENT_ID?.trim()) {
    names.push("oidc");
  }
  if ((process.env.FEATURE_OAUTH_MOCK ?? "").trim() === "true") {
    names.push("mock");
  }
  return names;
}

export function resolveSsoProvider(name: string): OAuthProvider | null {
  const redirectUri = `${appUrl()}/auth/oauth/${name}/callback`;
  if (name === "github" && process.env.GITHUB_CLIENT_ID?.trim()) {
    return new GitHubOAuthProvider({
      clientId: process.env.GITHUB_CLIENT_ID.trim(),
      clientSecret: process.env.GITHUB_CLIENT_SECRET?.trim() ?? "",
      redirectUri,
    });
  }
  if (name === "oidc" && process.env.OIDC_ISSUER?.trim() && process.env.OIDC_CLIENT_ID?.trim()) {
    return new OidcProvider({
      name: "oidc",
      issuer: process.env.OIDC_ISSUER.trim(),
      clientId: process.env.OIDC_CLIENT_ID.trim(),
      clientSecret: process.env.OIDC_CLIENT_SECRET?.trim() ?? "",
      redirectUri,
    });
  }
  if (name === "mock" && (process.env.FEATURE_OAUTH_MOCK ?? "").trim() === "true") {
    return new MockOAuthProvider({
      providerUserId: "mock-candidate",
      email: "sso.candidate@hiroapp.com",
      name: "SSO Candidate",
    });
  }
  return null;
}

export class SsoService {
  async loginFromProfile(provider: string, profile: OAuthProfile): Promise<UserRecord> {
    const existing = await oauthIdentities.findByProvider(provider, profile.providerUserId);
    if (existing) {
      const user = await users.findById(Number(existing.user_id));
      if (user) {
        return user;
      }
    }

    const email = profile.email.trim().toLowerCase();
    let user = await users.findByEmail(email);
    if (!user) {
      const names = splitName(profile.name);
      user = await users.create({
        first_name: names.first_name,
        last_name: names.last_name,
        email,
        password: await hashPassword(randomBytes(24).toString("hex")),
        role_id: ROLE.CANDIDATE,
        email_verified_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      });
    }

    await oauthIdentities.create({
      user_id: Number(user.id),
      provider,
      provider_user_id: profile.providerUserId,
      email,
      tenant_id: currentTenantId() ?? user.tenant_id ?? 1,
      created_at: new Date(),
    });
    return user;
  }
}

export const ssoService = new SsoService();
