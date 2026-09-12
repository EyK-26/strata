import { generateKeyPairSync } from "node:crypto";
import { SignedXml } from "xml-crypto";

interface SamlFixtureOptions {
  audience?: string;
  destination?: string;
  email?: string;
  issuer?: string;
  name?: string;
  nameId?: string;
  assertionId?: string;
  signed?: boolean;
  cert?: string;
  privateKey?: string;
}

function createIdpMaterial() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // node-saml wants an X509 cert. Bun/Node 22 can wrap a public key in a self-signed
  // cert via openssl when available; fall back to embedding the SPKI as a dummy cert
  // is not accepted. Use the X509Certificate-compatible PEM from `openssl` if present,
  // otherwise synthesize a minimal self-signed cert with webcrypto-incompatible path:
  // tests prefer openssl.
  return { privateKey, publicKey };
}

async function createSelfSignedCert(privateKey: string, publicKey: string): Promise<string> {
  const openssl = Bun.spawnSync({
    cmd: [
      "openssl",
      "req",
      "-x509",
      "-new",
      "-key",
      "/dev/stdin",
      "-days",
      "1",
      "-subj",
      "/CN=idp.test",
    ],
    stdin: new TextEncoder().encode(privateKey),
    stdout: "pipe",
    stderr: "pipe",
  });

  if (openssl.exitCode === 0 && openssl.stdout.length > 0) {
    return Buffer.from(openssl.stdout).toString("utf8");
  }

  // Last resort: some environments ship a cert already. Keep the public key PEM so
  // callers can still exercise unsigned-response paths.
  void publicKey;
  throw new Error(
    `Could not create a self-signed IdP cert: ${Buffer.from(openssl.stderr).toString("utf8")}`,
  );
}

function signSamlElement(xml: string, localName: string, privateKey: string, cert: string): string {
  const sig = new SignedXml({
    privateKey,
    publicCert: cert,
  });
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.addReference({
    xpath: `//*[local-name(.)='${localName}']`,
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });
  sig.computeSignature(xml, {
    location: {
      reference: `//*[local-name(.)='${localName}']/*[local-name(.)='Issuer']`,
      action: "after",
    },
  });
  return sig.getSignedXml();
}

async function createSignedSamlResponse(options: SamlFixtureOptions = {}): Promise<{
  cert: string;
  privateKey: string;
  responseB64: string;
  email: string;
}> {
  const generated = options.cert && options.privateKey ? null : createIdpMaterial();
  const privateKey = options.privateKey ?? generated?.privateKey ?? "";
  const cert =
    options.cert ??
    (generated ? await createSelfSignedCert(generated.privateKey, generated.publicKey) : "");
  const now = new Date();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + 5 * 60_000).toISOString();
  const assertionId = options.assertionId ?? `a${crypto.randomUUID().replaceAll("-", "")}`;
  const responseId = `r${crypto.randomUUID().replaceAll("-", "")}`;
  const email = options.email ?? "saml-user@example.test";
  const audience = options.audience ?? "https://sp.example.test/metadata";
  const destination = options.destination ?? "https://app.example.test/auth/saml/acs";
  const issuer = options.issuer ?? "https://idp.example.test/metadata";
  const name = options.name ?? "SAML User";
  const nameId = options.nameId ?? email;

  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" IssueInstant="${now.toISOString()}" Version="2.0">
  <saml:Issuer>${issuer}</saml:Issuer>
  <saml:Subject>
    <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${nameId}</saml:NameID>
    <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
      <saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${destination}" />
    </saml:SubjectConfirmation>
  </saml:Subject>
  <saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">
    <saml:AudienceRestriction>
      <saml:Audience>${audience}</saml:Audience>
    </saml:AudienceRestriction>
  </saml:Conditions>
  <saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${assertionId}">
    <saml:AuthnContext>
      <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef>
    </saml:AuthnContext>
  </saml:AuthnStatement>
  <saml:AttributeStatement>
    <saml:Attribute Name="email" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
      <saml:AttributeValue>${email}</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="name" NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:basic">
      <saml:AttributeValue>${name}</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>`;

  const unsigned = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="${responseId}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${destination}">
  <saml:Issuer xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">${issuer}</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  ${assertion}
</samlp:Response>`;

  let xml = unsigned;
  if (options.signed !== false) {
    xml = signSamlElement(unsigned, "Assertion", privateKey, cert);
    xml = signSamlElement(xml, "Response", privateKey, cert);
  }

  return {
    cert,
    privateKey,
    responseB64: Buffer.from(xml).toString("base64"),
    email,
  };
}

export { createSignedSamlResponse };
