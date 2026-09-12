import { missingOptionalPeer } from "../../runtime/optionalPeer";
import type { OAuthProfile } from "../oauth/types";

interface SamlServiceProviderOptions {
  idpSsoUrl: string;
  idpCert: string;
  spEntityId: string;
  acsUrl: string;
  idpIssuer?: string;
  wantAssertionsSigned?: boolean;
  wantAuthnResponseSigned?: boolean;
}

interface NodeSamlProfile {
  ID?: string;
  nameID?: string;
  email?: string;
  name?: string;
  sessionIndex?: string | string[];
  getAssertion?: () => { Assertion?: { $?: { ID?: string } } };
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

/** Process-local assertion replay cache. Not shared across workers or instances. */
const replayCache = new Map<string, number>();
const REPLAY_TTL_MS = 10 * 60 * 1000;

function readSamlEnvOptions(): SamlServiceProviderOptions {
  const idpSsoUrl = process.env.SAML_IDP_SSO_URL?.trim() ?? "";
  const idpCert = process.env.SAML_IDP_CERT?.trim() ?? "";
  const spEntityId = process.env.SAML_SP_ENTITY_ID?.trim() ?? "";
  const acsUrl = process.env.SAML_ACS_URL?.trim() ?? "";

  if (!idpSsoUrl || !idpCert || !spEntityId || !acsUrl) {
    throw new Error(
      "SAML requires SAML_IDP_SSO_URL, SAML_IDP_CERT, SAML_SP_ENTITY_ID, and SAML_ACS_URL.",
    );
  }

  return {
    idpSsoUrl,
    idpCert,
    spEntityId,
    acsUrl,
    ...(process.env.SAML_IDP_ISSUER?.trim()
      ? { idpIssuer: process.env.SAML_IDP_ISSUER.trim() }
      : {}),
    ...(process.env.SAML_WANT_RESPONSE_SIGNED === "true" ? { wantAuthnResponseSigned: true } : {}),
  };
}

function rememberAssertion(id: string): void {
  const now = Date.now();
  for (const [key, seenAt] of replayCache) {
    if (now - seenAt > REPLAY_TTL_MS) {
      replayCache.delete(key);
    }
  }

  if (replayCache.has(id)) {
    throw new Error("SAML assertion replay detected.");
  }

  replayCache.set(id, now);
}

function resetSamlReplayCacheForTests(): void {
  replayCache.clear();
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

  constructor(private readonly options: SamlServiceProviderOptions) {}

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
      acceptedClockSkewMs: 5000,
      wantAssertionsSigned: this.options.wantAssertionsSigned ?? true,
      wantAuthnResponseSigned: this.options.wantAuthnResponseSigned ?? false,
      disableRequestedAuthnContext: true,
      ...(this.options.idpIssuer ? { idpIssuer: this.options.idpIssuer } : {}),
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

    const assertionId = readAssertionId(profile);
    if (!assertionId) {
      throw new Error("SAML assertion did not include an ID.");
    }
    rememberAssertion(assertionId);

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
  createSamlServiceProvider,
  readSamlEnvOptions,
  resetSamlReplayCacheForTests,
  SamlServiceProvider,
  setNodeSamlLoaderForTests,
};
