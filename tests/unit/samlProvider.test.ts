import { describe, expect, test } from "bun:test";
import { SamlProvider } from "../../src/core/auth/oauth/samlProvider";

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

  test("rejects invalid assertion references", async () => {
    const provider = new SamlProvider("https://idp.example.com/login");

    await expect(provider.exchangeCode("oauth:bad")).rejects.toThrow(
      "Invalid SAML assertion reference.",
    );
  });
});
