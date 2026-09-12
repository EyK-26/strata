import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { SamlProvider } from "@getstrata/core/auth/oauth/samlProvider";
import {
  createSamlServiceProvider,
  InMemorySamlAssertionReplayStore,
  readSamlEnvOptions,
  resetSamlReplayCacheForTests,
  SamlServiceProvider,
  setNodeSamlLoaderForTests,
  setSamlAssertionReplayStoreForTests,
} from "@getstrata/core/auth/saml/samlServiceProvider";
import { restoreEnvVar } from "../helpers/restoreEnv";
import { createSignedSamlResponse } from "../helpers/samlFixture";

const SP_ENTITY = "https://sp.example.test/metadata";
const ACS = "https://app.example.test/auth/saml/acs";
const SSO = "https://idp.example.test/sso";
const IDP_ISSUER = "https://idp.example.test/metadata";

beforeEach(() => {
  setSamlAssertionReplayStoreForTests(new InMemorySamlAssertionReplayStore());
});

afterEach(() => {
  resetSamlReplayCacheForTests();
  setSamlAssertionReplayStoreForTests(null);
  setNodeSamlLoaderForTests(null);
});

describe("SamlProvider", () => {
  test("rejects the removed saml:email:name stub constructor", () => {
    expect(() => new SamlProvider("https://idp.example.com/login")).toThrow(
      "string constructor login stub has been removed",
    );
  });

  test("oauth helpers throw so callers use authorizationUrl and consumePost", async () => {
    const fixture = await createSignedSamlResponse();
    const provider = new SamlProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });

    expect(provider.name).toBe("saml");
    expect(() => provider.getAuthorizationUrl("state")).toThrow("authorization is async");
    await expect(provider.exchangeCode("saml:user@example.com:Jane")).rejects.toThrow(
      "consumePost()",
    );
    const url = await provider.authorizationUrl("relay-state");
    expect(url).toContain("SAMLRequest=");
    await expect(provider.consumePost("   ")).rejects.toThrow("SAML response is required");
  });
});

describe("SamlServiceProvider", () => {
  test("readSamlEnvOptions requires IdP metadata", () => {
    const previous = {
      sso: process.env.SAML_IDP_SSO_URL,
      cert: process.env.SAML_IDP_CERT,
      entity: process.env.SAML_SP_ENTITY_ID,
      acs: process.env.SAML_ACS_URL,
      issuer: process.env.SAML_IDP_ISSUER,
    };
    delete process.env.SAML_IDP_SSO_URL;
    delete process.env.SAML_IDP_CERT;
    delete process.env.SAML_SP_ENTITY_ID;
    delete process.env.SAML_ACS_URL;
    delete process.env.SAML_IDP_ISSUER;
    try {
      expect(() => readSamlEnvOptions()).toThrow("SAML requires");
    } finally {
      restoreEnvVar("SAML_IDP_SSO_URL", previous.sso);
      restoreEnvVar("SAML_IDP_CERT", previous.cert);
      restoreEnvVar("SAML_SP_ENTITY_ID", previous.entity);
      restoreEnvVar("SAML_ACS_URL", previous.acs);
      restoreEnvVar("SAML_IDP_ISSUER", previous.issuer);
    }
  });

  test("createSamlServiceProvider reads env options", async () => {
    const fixture = await createSignedSamlResponse();
    const previous = {
      sso: process.env.SAML_IDP_SSO_URL,
      cert: process.env.SAML_IDP_CERT,
      entity: process.env.SAML_SP_ENTITY_ID,
      acs: process.env.SAML_ACS_URL,
      issuer: process.env.SAML_IDP_ISSUER,
    };
    process.env.SAML_IDP_SSO_URL = SSO;
    process.env.SAML_IDP_CERT = fixture.cert;
    process.env.SAML_SP_ENTITY_ID = SP_ENTITY;
    process.env.SAML_ACS_URL = ACS;
    process.env.SAML_IDP_ISSUER = "https://idp.example.test/metadata";
    try {
      expect(createSamlServiceProvider()).toBeInstanceOf(SamlServiceProvider);
    } finally {
      restoreEnvVar("SAML_IDP_SSO_URL", previous.sso);
      restoreEnvVar("SAML_IDP_CERT", previous.cert);
      restoreEnvVar("SAML_SP_ENTITY_ID", previous.entity);
      restoreEnvVar("SAML_ACS_URL", previous.acs);
      restoreEnvVar("SAML_IDP_ISSUER", previous.issuer);
    }
  });

  test("readSamlEnvOptions honors issuer and response-signature flags", () => {
    const previous = {
      sso: process.env.SAML_IDP_SSO_URL,
      cert: process.env.SAML_IDP_CERT,
      entity: process.env.SAML_SP_ENTITY_ID,
      acs: process.env.SAML_ACS_URL,
      issuer: process.env.SAML_IDP_ISSUER,
      signed: process.env.SAML_WANT_RESPONSE_SIGNED,
    };
    process.env.SAML_IDP_SSO_URL = SSO;
    process.env.SAML_IDP_CERT = "cert";
    process.env.SAML_SP_ENTITY_ID = SP_ENTITY;
    process.env.SAML_ACS_URL = ACS;
    process.env.SAML_IDP_ISSUER = "https://idp.example.test";
    delete process.env.SAML_WANT_RESPONSE_SIGNED;
    try {
      const opts = readSamlEnvOptions();
      expect(opts.idpIssuer).toBe("https://idp.example.test");
      expect(opts.wantAuthnResponseSigned).toBe(true);
      expect(opts.disableRequestedAuthnContext).toBe(false);
      process.env.SAML_WANT_RESPONSE_SIGNED = "false";
      expect(readSamlEnvOptions().wantAuthnResponseSigned).toBe(false);
    } finally {
      restoreEnvVar("SAML_IDP_SSO_URL", previous.sso);
      restoreEnvVar("SAML_IDP_CERT", previous.cert);
      restoreEnvVar("SAML_SP_ENTITY_ID", previous.entity);
      restoreEnvVar("SAML_ACS_URL", previous.acs);
      restoreEnvVar("SAML_IDP_ISSUER", previous.issuer);
      restoreEnvVar("SAML_WANT_RESPONSE_SIGNED", previous.signed);
    }
  });

  test("authorizationUrl returns an IdP redirect", async () => {
    const fixture = await createSignedSamlResponse();
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    const url = await provider.authorizationUrl("relay-state");
    expect(url).toContain("SAMLRequest=");
    expect(url).toContain("RelayState=relay-state");
  });

  test("consumePost rejects an empty response", async () => {
    const fixture = await createSignedSamlResponse();
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost("   ")).rejects.toThrow("SAML response is required");
  });

  test("consumePost rejects an unsigned assertion", async () => {
    const fixture = await createSignedSamlResponse({ signed: false });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost(fixture.responseB64)).rejects.toThrow();
  });

  test("consumePost rejects a wrong audience", async () => {
    const fixture = await createSignedSamlResponse({ audience: "https://other.example/metadata" });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost(fixture.responseB64)).rejects.toThrow();
  });

  test("consumePost accepts a signed assertion and rejects replay", async () => {
    const fixture = await createSignedSamlResponse({
      audience: SP_ENTITY,
      destination: ACS,
    });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    const profile = await provider.consumePost(fixture.responseB64, "relay");
    expect(profile.email).toBe(fixture.email);
    expect(profile.providerUserId).toBeTruthy();
    await expect(provider.consumePost(fixture.responseB64, "relay")).rejects.toThrow("replay");
  });

  test("consumePost surfaces logged-out and missing-email profiles", async () => {
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return { profile: { ID: "assert-missing-email", nameID: "x" }, loggedOut: false };
        }
      },
    }));
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost("Zg==")).rejects.toThrow("email address");

    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return { profile: null, loggedOut: true };
        }
      },
    }));
    const loggedOut = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(loggedOut.consumePost("Zg==")).rejects.toThrow("signed user profile");
  });

  test("maps the email OID attribute and expires the replay cache", async () => {
    const now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            profile: {
              ID: "assert-1",
              nameID: "nid",
              "urn:oid:0.9.2342.19200300.100.1.3": "oid@example.test",
              sessionIndex: ["s1"],
            },
            loggedOut: false,
          };
        }
      },
    }));
    try {
      const provider = new SamlServiceProvider({
        idpSsoUrl: SSO,
        idpIssuer: IDP_ISSUER,
        idpCert: "cert",
        spEntityId: SP_ENTITY,
        acsUrl: ACS,
      });
      const profile = await provider.consumePost("Zg==");
      expect(profile).toEqual({
        providerUserId: "nid",
        email: "oid@example.test",
        name: "oid@example.test",
      });
      Date.now = () => now + 11 * 60 * 1000;
      const again = await provider.consumePost("Zg==");
      expect(again.email).toBe("oid@example.test");
    } finally {
      Date.now = originalNow;
    }

    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            profile: { email: "fallback@example.test", name: "Pat", sessionIndex: "s" },
            loggedOut: false,
          };
        }
      },
    }));
    const fallback = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(fallback.consumePost("Zg==")).rejects.toThrow("did not include an ID");

    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            profile: {
              email: "from-assertion@example.test",
              getAssertion: () => ({ Assertion: { $: { ID: "assert-from-xml" } } }),
            },
            loggedOut: false,
          };
        }
      },
    }));
    const fromXml = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    expect((await fromXml.consumePost("Zg==")).email).toBe("from-assertion@example.test");
    await expect(fromXml.consumePost("Zg==")).rejects.toThrow("replay");
  });

  test("honors wantAuthnResponseSigned from options", async () => {
    let captured: Record<string, unknown> | undefined;
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        constructor(options: Record<string, unknown>) {
          captured = options;
        }
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return { profile: null, loggedOut: false };
        }
      },
    }));
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
      wantAuthnResponseSigned: true,
    });
    await provider.authorizationUrl("relay");
    expect(captured?.wantAuthnResponseSigned).toBe(true);
    expect(captured?.disableRequestedAuthnContext).toBe(false);
    expect(captured?.idpIssuer).toBe(IDP_ISSUER);
  });

  test("defaults wantAuthnResponseSigned to true and requests AuthnContext", async () => {
    let captured: Record<string, unknown> | undefined;
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        constructor(options: Record<string, unknown>) {
          captured = options;
        }
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return { profile: null, loggedOut: false };
        }
      },
    }));
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await provider.authorizationUrl("relay");
    expect(captured?.wantAuthnResponseSigned).toBe(true);
    expect(captured?.disableRequestedAuthnContext).toBe(false);
  });

  test("rejects a missing IdP issuer", () => {
    expect(
      () =>
        new SamlServiceProvider({
          idpSsoUrl: SSO,
          idpIssuer: "  ",
          idpCert: "cert",
          spEntityId: SP_ENTITY,
          acsUrl: ACS,
        }),
    ).toThrow("idpIssuer is required");
  });

  test("missing optional peer becomes a missingOptionalPeer error", async () => {
    setNodeSamlLoaderForTests(async () => {
      throw Object.assign(new Error("Cannot find package"), { code: "ERR_MODULE_NOT_FOUND" });
    });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.authorizationUrl("x")).rejects.toThrow("@node-saml/node-saml");
  });
});
