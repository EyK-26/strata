import { describe, expect, test } from "bun:test";
import { SamlProvider } from "@getstrata/core/auth/oauth/samlProvider";
import { restoreEnvVar } from "../helpers/restoreEnv";

describe("SamlProvider", () => {
  test("builds an authorization url with encoded state", () => {
    const provider = new SamlProvider("https://idp.example.com/login");

    expect(provider.name).toBe("saml");
    expect(provider.getAuthorizationUrl("state value")).toBe(
      "https://idp.example.com/login?state=state%20value",
    );
  });

  test("parses a valid saml assertion reference", async () => {
    const provider = new SamlProvider("https://idp.example.com/login");
    const profile = await provider.exchangeCode("saml:user@example.com:Jane Doe");

    expect(profile).toEqual({
      providerUserId: "user@example.com",
      email: "user@example.com",
      name: "Jane Doe",
    });
  });

  test("uses defaults when the name segment is missing", async () => {
    const provider = new SamlProvider("https://idp.example.com/login");
    const profile = await provider.exchangeCode("saml:user@example.com");

    expect(profile).toEqual({
      providerUserId: "user@example.com",
      email: "user@example.com",
      name: "SAML User",
    });
  });

  test("uses a prefix-scoped email when the assertion omits one", async () => {
    const previous = process.env.APP_KEY_PREFIX;
    delete process.env.APP_KEY_PREFIX;
    const provider = new SamlProvider("https://idp.example.com/login");

    try {
      await expect(provider.exchangeCode("saml::Admin")).resolves.toEqual({
        providerUserId: "saml-user",
        email: "saml-user@workhub.test",
        name: "Admin",
      });
    } finally {
      restoreEnvVar("APP_KEY_PREFIX", previous);
    }
  });

  test("rejects invalid assertion references", async () => {
    const provider = new SamlProvider("https://idp.example.com/login");

    await expect(provider.exchangeCode("oauth:bad")).rejects.toThrow(
      "Invalid SAML assertion reference.",
    );
  });
});
