import { missingOptionalPeer } from "../../runtime/optionalPeer";
import { timingSafeCompareString } from "../../security/timingSafeCompare";
import type { OAuthProfile } from "../oauth/types";
import {
  consumeSamlAssertion,
  InMemorySamlAssertionReplayStore,
  REPLAY_RETENTION_MS,
  resetSamlReplayCacheForTests,
  setSamlAssertionReplayStoreForTests,
} from "./samlAssertionReplay";

interface SamlServiceProviderOptions {
  idpSsoUrl: string;
  idpCert: string;
  spEntityId: string;
  acsUrl: string;
  idpIssuer: string;
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
  disableRequestedAuthnContext?: boolean;
}

interface VerifiedSamlAssertion {
  Assertion?: {
    $?: { ID?: string };
    Subject?: Array<{
      SubjectConfirmation?: Array<{
        $?: { Method?: string };
        SubjectConfirmationData?: Array<{
          $?: { Recipient?: string; NotBefore?: string; NotOnOrAfter?: string };
        }>;
      }>;
    }>;
  };
}

const CLOCK_SKEW_MS = 5000;

interface NodeSamlProfile {
  ID?: string;
  nameID?: string;
  email?: string;
  name?: string;
  issuer?: string;
  sessionIndex?: string | string[];
  getAssertion?: () => VerifiedSamlAssertion;
  getSamlResponseXml?: () => string;
  [key: string]: unknown;
}

function readAssertionId(profile: NodeSamlProfile): string {
  if (typeof profile.ID === "string" && profile.ID.trim()) {
    return profile.ID.trim();
  }

  const parsed = typeof profile.getAssertion === "function" ? profile.getAssertion() : null;
  const assertionId = parsed?.Assertion?.$?.ID;
  return typeof assertionId === "string" ? assertionId.trim() : "";
}

/** Read only the signature-verified assertion exposed by node-saml. */
function assertBearerRecipient(profile: NodeSamlProfile, acsUrl: string): void {
  const subjects = profile.getAssertion?.()?.Assertion?.Subject;
  const confirmations =
    Array.isArray(subjects) && subjects.length === 1 ? subjects[0]?.SubjectConfirmation : undefined;
  const now = Date.now();
  const matches =
    Array.isArray(confirmations) &&
    confirmations.some((confirmation) => {
      if (confirmation?.$?.Method !== "urn:oasis:names:tc:SAML:2.0:cm:bearer") return false;
      const data = confirmation.SubjectConfirmationData;
      if (!Array.isArray(data) || data.length !== 1) return false;
      const attributes = data[0]?.$;
      if (attributes?.Recipient !== acsUrl || attributes.NotBefore !== undefined) return false;
      if (typeof attributes.NotOnOrAfter !== "string") return false;
      const expires = Date.parse(attributes.NotOnOrAfter);
      return Number.isFinite(expires) && now < expires + CLOCK_SKEW_MS;
    });
  if (!matches) throw new Error("SAML assertion bearer recipient is invalid.");
}

/** Envelope metadata is additional admission policy, never signature verification. */
async function assertResponseDestination(profile: NodeSamlProfile, acsUrl: string): Promise<void> {
  const xml = profile.getSamlResponseXml?.();
  const invalid = () => new Error("SAML response destination is invalid.");
  if (typeof xml !== "string" || !xml.trim()) throw invalid();
  // Keep the parser's ambient browser DOM declarations out of Bun's public type graph.
  const parserModule = "@xmldom/xmldom";
  const { DOMParser } = (await import(parserModule)) as {
    DOMParser: new (options: {
      errorHandler: () => never;
    }) => {
      parseFromString(
        xml: string,
        mimeType: string,
      ): {
        doctype: unknown;
        documentElement: {
          localName: string;
          namespaceURI: string;
          getAttribute(name: string): string | null;
        } | null;
      };
    };
  };
  const document = new DOMParser({
    errorHandler: () => {
      throw invalid();
    },
  }).parseFromString(xml, "application/xml");
  const response = document.documentElement;
  if (
    document.doctype ||
    response?.localName !== "Response" ||
    response.namespaceURI !== "urn:oasis:names:tc:SAML:2.0:protocol" ||
    response.getAttribute("Destination") !== acsUrl
  )
    throw invalid();
}

type NodeSamlClient = {
  getAuthorizeUrlAsync(
    relayState: string,
    host: string | undefined,
    options: object,
  ): Promise<string>;
  validatePostResponseAsync(container: Record<string, string>): Promise<{
    profile: NodeSamlProfile | null;
    loggedOut: boolean;
  }>;
};

function requireSamlOption(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${name} is required.`);
  }

  return trimmed;
}

function readSamlEnvOptions(): SamlServiceProviderOptions {
  const idpSsoUrl = process.env.SAML_IDP_SSO_URL?.trim() ?? "";
  const idpCert = process.env.SAML_IDP_CERT?.trim() ?? "";
  const spEntityId = process.env.SAML_SP_ENTITY_ID?.trim() ?? "";
  const acsUrl = process.env.SAML_ACS_URL?.trim() ?? "";
  const idpIssuer = process.env.SAML_IDP_ISSUER?.trim() ?? "";

  if (!idpSsoUrl || !idpCert || !spEntityId || !acsUrl || !idpIssuer) {
    throw new Error(
      "SAML requires SAML_IDP_SSO_URL, SAML_IDP_CERT, SAML_SP_ENTITY_ID, SAML_ACS_URL, and SAML_IDP_ISSUER.",
    );
  }

  return {
    idpSsoUrl,
    idpCert,
    spEntityId,
    acsUrl,
    idpIssuer,
    wantAuthnResponseSigned: process.env.SAML_WANT_RESPONSE_SIGNED !== "false",
    disableRequestedAuthnContext: process.env.SAML_DISABLE_REQUESTED_AUTHN_CONTEXT === "true",
  };
}

type NodeSamlModule = { SAML: new (options: Record<string, unknown>) => NodeSamlClient };

let nodeSamlLoader: (() => Promise<NodeSamlModule>) | null = null;

async function defaultLoadNodeSaml(): Promise<NodeSamlModule> {
  return (await import("@node-saml/node-saml")) as unknown as NodeSamlModule;
}

async function loadNodeSaml(): Promise<NodeSamlModule> {
  try {
    return await (nodeSamlLoader ?? defaultLoadNodeSaml)();
  } catch (error) {
    throw missingOptionalPeer("@node-saml/node-saml", "to verify SAML assertions", error);
  }
}

function setNodeSamlLoaderForTests(loader: (() => Promise<NodeSamlModule>) | null): void {
  nodeSamlLoader = loader;
}

class SamlServiceProvider {
  private client: NodeSamlClient | null = null;

  constructor(private readonly options: SamlServiceProviderOptions) {
    requireSamlOption(options.idpSsoUrl, "idpSsoUrl");
    requireSamlOption(options.idpCert, "idpCert");
    requireSamlOption(options.spEntityId, "spEntityId");
    requireSamlOption(options.acsUrl, "acsUrl");
    requireSamlOption(options.idpIssuer, "idpIssuer");
  }

  private async getClient(): Promise<NodeSamlClient> {
    if (this.client) {
      return this.client;
    }

    const { SAML } = await loadNodeSaml();
    this.client = new SAML({
      callbackUrl: this.options.acsUrl,
      entryPoint: this.options.idpSsoUrl,
      issuer: this.options.spEntityId,
      idpCert: this.options.idpCert,
      audience: this.options.spEntityId,
      idpIssuer: this.options.idpIssuer,
      acceptedClockSkewMs: CLOCK_SKEW_MS,
      wantAssertionsSigned: this.options.wantAssertionsSigned ?? true,
      wantAuthnResponseSigned: this.options.wantAuthnResponseSigned ?? true,
      disableRequestedAuthnContext: this.options.disableRequestedAuthnContext ?? false,
    });
    return this.client;
  }

  async authorizationUrl(relayState: string): Promise<string> {
    const client = await this.getClient();
    return await client.getAuthorizeUrlAsync(relayState, undefined, {});
  }

  async consumePost(samlResponse: string, relayState?: string): Promise<OAuthProfile> {
    if (!samlResponse.trim()) {
      throw new Error("SAML response is required.");
    }

    const client = await this.getClient();
    const { profile, loggedOut } = await client.validatePostResponseAsync({
      SAMLResponse: samlResponse,
      ...(relayState ? { RelayState: relayState } : {}),
    });

    if (loggedOut || !profile) {
      throw new Error("SAML assertion did not contain a signed user profile.");
    }

    const issuer = typeof profile.issuer === "string" ? profile.issuer.trim() : "";
    if (!issuer || !timingSafeCompareString(issuer, this.options.idpIssuer)) {
      throw new Error("SAML assertion issuer is invalid.");
    }

    const assertionId = readAssertionId(profile);
    if (!assertionId) {
      throw new Error("SAML assertion did not include an ID.");
    }
    assertBearerRecipient(profile, this.options.acsUrl);
    await assertResponseDestination(profile, this.options.acsUrl);
    await consumeSamlAssertion(assertionId);

    const email =
      profile.email ||
      (typeof profile["urn:oid:0.9.2342.19200300.100.1.3"] === "string"
        ? profile["urn:oid:0.9.2342.19200300.100.1.3"]
        : "") ||
      "";

    if (!email) {
      throw new Error("SAML assertion did not include an email address.");
    }

    return {
      providerUserId: profile.nameID || email,
      email,
      name: typeof profile.name === "string" && profile.name.trim() ? profile.name : email,
    };
  }
}

function createSamlServiceProvider(
  options: SamlServiceProviderOptions = readSamlEnvOptions(),
): SamlServiceProvider {
  return new SamlServiceProvider(options);
}

export type { SamlServiceProviderOptions };
export {
  consumeSamlAssertion,
  createSamlServiceProvider,
  InMemorySamlAssertionReplayStore,
  REPLAY_RETENTION_MS,
  readSamlEnvOptions,
  resetSamlReplayCacheForTests,
  SamlServiceProvider,
  setNodeSamlLoaderForTests,
  setSamlAssertionReplayStoreForTests,
};
