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

type Confirmation = {
  $?: { Method?: string };
  SubjectConfirmationData?: Array<{
    $?: { Recipient?: string; NotBefore?: string; NotOnOrAfter?: string };
  }>;
};
function validConfirmation(): Confirmation {
  return {
    $: { Method: "urn:oasis:names:tc:SAML:2.0:cm:bearer" },
    SubjectConfirmationData: [
      { $: { Recipient: ACS, NotOnOrAfter: new Date(Date.now() + 3600000).toISOString() } },
    ],
  };
}
function verifiedResponse() {
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" Destination="${ACS}"/>`;
}
function verifiedAssertion(id: string, confirmations: Confirmation[] = [validConfirmation()]) {
  return { Assertion: { $: { ID: id }, Subject: [{ SubjectConfirmation: confirmations }] } };
}

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

  test("rejects a validly signed assertion for a different bearer recipient", async () => {
    const fixture = await createSignedSamlResponse({
      audience: SP_ENTITY,
      destination: ACS,
      recipient: `${ACS}/other`,
    });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost(fixture.responseB64)).rejects.toThrow("bearer recipient");
  });

  test("rejects a signed response destination independently of a correct bearer recipient", async () => {
    const fixture = await createSignedSamlResponse({
      audience: SP_ENTITY,
      destination: `${ACS}/other`,
      recipient: ACS,
    });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost(fixture.responseB64)).rejects.toThrow("response destination");
  });

  test("checks response root, namespace and destination without consuming invalid replay state", async () => {
    let xml = "";
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            loggedOut: false,
            profile: {
              ID: "destination-test",
              issuer: IDP_ISSUER,
              email: "destination@example.test",
              getAssertion: () => verifiedAssertion("destination-test"),
              getSamlResponseXml: () => xml,
            },
          };
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
    for (const value of [
      "",
      "<broken",
      "<?xml version='1.0'?>",
      verifiedResponse().replace("Response", "Other"),
      verifiedResponse().replace("urn:oasis:names:tc:SAML:2.0:protocol", "urn:other"),
      verifiedResponse().replace(` Destination="${ACS}"`, ""),
      verifiedResponse().replace(ACS, `${ACS}/other`),
      `<!DOCTYPE samlp:Response>${verifiedResponse()}`,
    ]) {
      xml = value;
      await expect(provider.consumePost("Zg==")).rejects.toThrow("response destination");
    }
    xml = verifiedResponse();
    expect((await provider.consumePost("Zg==")).email).toBe("destination@example.test");
    await expect(provider.consumePost("Zg==")).rejects.toThrow("replay");
  });

  test("requires one matching unexpired bearer confirmation before consuming replay state", async () => {
    let assertion: ReturnType<typeof verifiedAssertion> | undefined;
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            loggedOut: false,
            profile: {
              ID: "bearer-test",
              issuer: IDP_ISSUER,
              email: "bearer@example.test",
              getSamlResponseXml: verifiedResponse,
              getAssertion: () => assertion ?? {},
            },
          };
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
    await expect(provider.consumePost("Zg==")).rejects.toThrow("bearer recipient");
    const invalid: Confirmation[][] = [
      [],
      [{}],
      [{ $: { Method: "other" } }],
      [{ $: validConfirmation().$, SubjectConfirmationData: [] }],
      [{ $: validConfirmation().$, SubjectConfirmationData: [{}] }],
      [{ $: validConfirmation().$, SubjectConfirmationData: [{ $: { Recipient: ACS } }] }],
      ...["not-a-time", new Date(Date.now() - 60000).toISOString()].map((NotOnOrAfter) => [
        {
          $: validConfirmation().$,
          SubjectConfirmationData: [{ $: { Recipient: ACS, NotOnOrAfter } }],
        },
      ]),
      [
        {
          $: validConfirmation().$,
          SubjectConfirmationData: [
            {
              $: {
                ...validConfirmation().SubjectConfirmationData?.[0]?.$,
                NotBefore: new Date().toISOString(),
              },
            },
          ],
        },
      ],
      // A valid time on another recipient must not validate an expired matching recipient.
      [
        {
          $: validConfirmation().$,
          SubjectConfirmationData: [
            {
              $: {
                Recipient: `${ACS}/other`,
                NotOnOrAfter: new Date(Date.now() + 60000).toISOString(),
              },
            },
          ],
        },
        {
          $: validConfirmation().$,
          SubjectConfirmationData: [
            { $: { Recipient: ACS, NotOnOrAfter: new Date(Date.now() - 60000).toISOString() } },
          ],
        },
      ],
    ];
    for (const confirmations of invalid) {
      assertion = verifiedAssertion("bearer-test", confirmations);
      await expect(provider.consumePost("Zg==")).rejects.toThrow("bearer recipient");
    }
    assertion = verifiedAssertion("bearer-test", [{ $: { Method: "other" } }, validConfirmation()]);
    expect((await provider.consumePost("Zg==")).email).toBe("bearer@example.test");
    await expect(provider.consumePost("Zg==")).rejects.toThrow("replay");
  });

  test("consumePost rejects a signed assertion from a different IdP issuer", async () => {
    const fixture = await createSignedSamlResponse({
      audience: SP_ENTITY,
      destination: ACS,
      issuer: "https://evil.example/idp",
    });
    const provider = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: fixture.cert,
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(provider.consumePost(fixture.responseB64)).rejects.toThrow("issuer is invalid");
  });

  test("consumePost surfaces logged-out and missing-email profiles", async () => {
    setNodeSamlLoaderForTests(async () => ({
      SAML: class {
        async getAuthorizeUrlAsync() {
          return SSO;
        }
        async validatePostResponseAsync() {
          return {
            profile: {
              ID: "assert-missing-email",
              nameID: "x",
              issuer: IDP_ISSUER,
              getSamlResponseXml: verifiedResponse,
              getAssertion: () => verifiedAssertion("assert-missing-email"),
            },
            loggedOut: false,
          };
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
          return {
            profile: {
              ID: "assert-wrong-issuer",
              nameID: "x",
              email: "stolen@example.test",
              issuer: "https://evil.example/idp",
            },
            loggedOut: false,
          };
        }
      },
    }));
    const wrongIssuer = new SamlServiceProvider({
      idpSsoUrl: SSO,
      idpIssuer: IDP_ISSUER,
      idpCert: "cert",
      spEntityId: SP_ENTITY,
      acsUrl: ACS,
    });
    await expect(wrongIssuer.consumePost("Zg==")).rejects.toThrow("issuer is invalid");

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

  test("maps the email OID attribute and keeps replay IDs after the old cache TTL", async () => {
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
              getSamlResponseXml: verifiedResponse,
              getAssertion: () => verifiedAssertion("assert-1"),
              nameID: "nid",
              issuer: IDP_ISSUER,
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
      await expect(provider.consumePost("Zg==")).rejects.toThrow("replay");
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
            profile: {
              email: "fallback@example.test",
              name: "Pat",
              sessionIndex: "s",
              issuer: IDP_ISSUER,
            },
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
              issuer: IDP_ISSUER,
              getSamlResponseXml: verifiedResponse,
              getAssertion: () => verifiedAssertion("assert-from-xml"),
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
