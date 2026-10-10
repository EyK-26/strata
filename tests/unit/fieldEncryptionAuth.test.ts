import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import {
  emailLookupForQuery,
  isFieldEncryptionEnabled,
  protectEmail,
  resolveFieldEncryptionKeyring,
  revealEmail,
} from "@getstrata/core/crypto/fieldEncryption";
import { protectMfaSecret, revealMfaSecret } from "@getstrata/core/crypto/mfaSecret";
import { restoreEnvVar } from "../helpers/restoreEnv";

const names = [
  "KMS_ENCRYPTION_KEY",
  "KMS_ENCRYPTION_KEYRING",
  "FEATURE_FIELD_ENCRYPTION",
  "APP_ENV",
] as const;
const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
afterEach(() => {
  for (const name of names) restoreEnvVar(name, saved[name]);
});
const original = "11".repeat(32),
  next = "22".repeat(32);
const configuration = (writeVersion: 1 | 2 = 2) => ({
  activeKeyId: "next",
  encryptionKeys: { old: original, next },
  legacyV1Key: original,
  lookupKey: original,
  writeVersion,
});
function configure(writeVersion: 1 | 2 = 2) {
  delete process.env.KMS_ENCRYPTION_KEY;
  process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify(configuration(writeVersion));
  delete process.env.FEATURE_FIELD_ENCRYPTION;
  process.env.APP_ENV = "production";
}
test("reader-first adoption preserves existing email lookups and MFA, then enables identified writes", () => {
  delete process.env.KMS_ENCRYPTION_KEYRING;
  process.env.KMS_ENCRYPTION_KEY = original;
  process.env.FEATURE_FIELD_ENCRYPTION = "true";
  const previousEmail = protectEmail(" User@Example.test ");
  const previousMfa = protectMfaSecret("JBSWY3DPEHPK3PXP");
  configure(1);
  expect(resolveFieldEncryptionKeyring()?.writeVersion).toBe(1);
  expect(isFieldEncryptionEnabled()).toBe(true);
  expect(revealEmail(previousEmail.storedEmail)).toBe("user@example.test");
  expect(revealMfaSecret(previousMfa)).toBe("JBSWY3DPEHPK3PXP");
  expect(protectEmail("USER@example.test").storedEmail.startsWith("enc:v1:")).toBe(true);
  expect(protectMfaSecret("secret").startsWith("enc:v1:")).toBe(true);
  expect(emailLookupForQuery(" user@example.test ")).toBe(previousEmail.emailLookup);
  configure(2);
  const current = protectEmail("User@example.test");
  const mfa = protectMfaSecret("secret");
  expect(current.storedEmail.startsWith("enc:v2:next:")).toBe(true);
  expect(mfa.startsWith("enc:v2:next:")).toBe(true);
  expect(current.emailLookup).toBe(previousEmail.emailLookup);
  expect(emailLookupForQuery("USER@example.test")).toBe(current.emailLookup);
  expect(revealEmail(current.storedEmail)).toBe("user@example.test");
  expect(revealMfaSecret(mfa)).toBe("secret");
  expect(() => revealMfaSecret(current.storedEmail)).toThrow("Unable to decrypt");
  expect(() => revealEmail(mfa)).toThrow("Unable to decrypt");
  configure(1);
  expect(revealEmail(current.storedEmail)).toBe("user@example.test");
  expect(revealMfaSecret(mfa)).toBe("secret");
});
test("keyring reads ignore write flag and MFA remains encrypted with email encryption disabled", () => {
  configure();
  const email = protectEmail("user@example.test");
  const mfa = protectMfaSecret("secret");
  process.env.FEATURE_FIELD_ENCRYPTION = "false";
  expect(isFieldEncryptionEnabled()).toBe(false);
  expect(protectEmail("User@example.test")).toEqual({
    storedEmail: "user@example.test",
    emailLookup: "user@example.test",
  });
  expect(emailLookupForQuery("User@example.test")).toBe("user@example.test");
  expect(revealEmail(email.storedEmail)).toBe("user@example.test");
  expect(revealMfaSecret(mfa)).toBe("secret");
  expect(protectMfaSecret("secret").startsWith("enc:v2:")).toBe(true);
  expect(revealMfaSecret(null)).toBeNull();
  expect(revealEmail("plain@example.test")).toBe("plain@example.test");
  expect(() => revealMfaSecret("plaintext")).toThrow("must be encrypted");
  process.env.FEATURE_FIELD_ENCRYPTION = "true";
  expect(protectEmail("user@example.test").storedEmail.startsWith("enc:v2:")).toBe(true);
});
test("missing or malformed configuration never treats identified ciphertext as plaintext", () => {
  configure();
  const email = protectEmail("user@example.test").storedEmail;
  const mfa = protectMfaSecret("secret");
  delete process.env.KMS_ENCRYPTION_KEYRING;
  delete process.env.KMS_ENCRYPTION_KEY;
  expect(() => revealEmail(email)).toThrow("KMS_ENCRYPTION_KEYRING");
  expect(() => revealMfaSecret(mfa)).toThrow("KMS_ENCRYPTION_KEYRING");
  for (const config of [
    "",
    " ",
    "broken",
    "[]",
    "null",
    "x".repeat(16385),
    JSON.stringify({ ...configuration(), other: "private" }),
    JSON.stringify({ ...configuration(), activeKeyId: 1 }),
    JSON.stringify({ ...configuration(), writeVersion: 3 }),
    JSON.stringify({ ...configuration(), encryptionKeys: [] }),
    JSON.stringify({ ...configuration(), encryptionKeys: null }),
    JSON.stringify({ ...configuration(), encryptionKeys: { next: 3 } }),
    JSON.stringify({ ...configuration(), lookupKey: "bad" }),
    JSON.stringify({ ...configuration(), lookupKey: "22".repeat(32) }),
    JSON.stringify({ ...configuration(1), legacyV1Key: undefined }),
  ]) {
    process.env.KMS_ENCRYPTION_KEYRING = config;
    expect(() => protectEmail("private@example.test")).toThrow(
      "Invalid KMS_ENCRYPTION_KEYRING configuration.",
    );
    expect(() => protectMfaSecret("private")).toThrow(
      "Invalid KMS_ENCRYPTION_KEYRING configuration.",
    );
  }
  configure();
  process.env.KMS_ENCRYPTION_KEY = original;
  expect(() => resolveFieldEncryptionKeyring()).toThrow(
    "Invalid KMS_ENCRYPTION_KEYRING configuration.",
  );
  configure();
  process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify({
    ...configuration(),
    encryptionKeys: { next: Buffer.from(next, "hex").toString("base64") },
  });
  expect(protectMfaSecret("secret").startsWith("enc:v2:")).toBe(true);
  process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify({
    ...configuration(),
    legacyV1Key: undefined,
  });
  expect(resolveFieldEncryptionKeyring()?.writeVersion).toBe(2);
});
test("separately bundled email and MFA entrypoints use the same configuration in three processes", async () => {
  configure();
  const config = process.env.KMS_ENCRYPTION_KEYRING;
  const program = `import {protectEmail,emailLookupForQuery,revealEmail} from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/fieldEncryption.js"))};import{protectMfaSecret,revealMfaSecret}from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/mfaSecret.js"))};const email=protectEmail('User@example.test');const mfa=protectMfaSecret('secret');console.log(JSON.stringify({email:revealEmail(email.storedEmail),lookup:emailLookupForQuery('user@example.test'),storedLookup:email.emailLookup,mfa:revealMfaSecret(mfa),version:email.storedEmail.split(':').slice(0,3)}));`;
  const snapshots = await Promise.all(
    Array.from({ length: 3 }, async () => {
      const child = Bun.spawn([process.execPath, "--no-env-file", "-e", program], {
        env: { PATH: process.env.PATH, KMS_ENCRYPTION_KEYRING: config, APP_ENV: "production" },
        stdout: "pipe",
        stderr: "ignore",
      });
      const body = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      return JSON.parse(body);
    }),
  );
  expect(snapshots[0]).toEqual(snapshots[1]);
  expect(snapshots[1]).toEqual(snapshots[2]);
  expect(snapshots[0].lookup).toBe(snapshots[0].storedLookup);
  expect(snapshots[0].version).toEqual(["enc", "v2", "next"]);
});

test("startup and secrets checks validate the supplied keyring environment without reading ambient keys", () => {
  const env = {
    APP_ENV: "production",
    APP_URL: "https://example.test",
    AUTH_DEV_HEADERS: "false",
    FEATURE_PUBLIC_READS: "false",
    FRONTEND_MODE: "api",
    FEATURE_MFA: "true",
    KMS_ENCRYPTION_KEYRING: JSON.stringify(configuration()),
  };
  expect(() => assertProductionSecrets(env)).not.toThrow();
  expect(() =>
    assertProductionSecrets({ ...env, KMS_ENCRYPTION_KEYRING: "private-invalid" }),
  ).toThrow("Invalid KMS_ENCRYPTION_KEYRING configuration.");
  expect(() =>
    assertProductionSecrets({ APP_ENV: "local", KMS_ENCRYPTION_KEYRING: "broken" }),
  ).toThrow("Invalid KMS_ENCRYPTION_KEYRING configuration.");
  expect(() => assertProductionSecrets({ ...env, KMS_ENCRYPTION_KEY: original })).toThrow(
    "Invalid KMS_ENCRYPTION_KEYRING configuration.",
  );
});
