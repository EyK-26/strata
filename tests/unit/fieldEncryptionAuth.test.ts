import { afterEach, expect, test } from "bun:test";
import { resolve } from "node:path";
import { assertProductionSecrets } from "@getstrata/bootstrap/secretsGuard";
import {
  createFieldEncryptionCodec,
  emailLookupForQuery,
  isFieldEncryptionEnabled,
  protectEmail,
  resolveFieldEncryptionKeyring,
  revealEmail,
} from "@getstrata/core/crypto/fieldEncryption";
import {
  createMfaSecretCodec,
  protectMfaSecret,
  revealMfaSecret,
} from "@getstrata/core/crypto/mfaSecret";
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
  const previousEmail = protectEmail(
    " User@Example.test ",
    createFieldEncryptionCodec(process.env),
  );
  const previousMfa = protectMfaSecret("JBSWY3DPEHPK3PXP", createMfaSecretCodec(process.env));
  configure(1);
  expect(resolveFieldEncryptionKeyring(process.env)?.writeVersion).toBe(1);
  expect(isFieldEncryptionEnabled(createFieldEncryptionCodec(process.env))).toBe(true);
  expect(revealEmail(previousEmail.storedEmail, createFieldEncryptionCodec(process.env))).toBe(
    "user@example.test",
  );
  expect(revealMfaSecret(previousMfa, createMfaSecretCodec(process.env))).toBe("JBSWY3DPEHPK3PXP");
  expect(
    protectEmail(
      "USER@example.test",
      createFieldEncryptionCodec(process.env),
    ).storedEmail.startsWith("enc:v1:"),
  ).toBe(true);
  expect(protectMfaSecret("secret", createMfaSecretCodec(process.env)).startsWith("enc:v1:")).toBe(
    true,
  );
  expect(emailLookupForQuery(" user@example.test ", createFieldEncryptionCodec(process.env))).toBe(
    previousEmail.emailLookup,
  );
  configure(2);
  const current = protectEmail("User@example.test", createFieldEncryptionCodec(process.env));
  const mfa = protectMfaSecret("secret", createMfaSecretCodec(process.env));
  expect(current.storedEmail.startsWith("enc:v2:next:")).toBe(true);
  expect(mfa.startsWith("enc:v2:next:")).toBe(true);
  expect(current.emailLookup).toBe(previousEmail.emailLookup);
  expect(emailLookupForQuery("USER@example.test", createFieldEncryptionCodec(process.env))).toBe(
    current.emailLookup,
  );
  expect(revealEmail(current.storedEmail, createFieldEncryptionCodec(process.env))).toBe(
    "user@example.test",
  );
  expect(revealMfaSecret(mfa, createMfaSecretCodec(process.env))).toBe("secret");
  expect(() => revealMfaSecret(current.storedEmail, createMfaSecretCodec(process.env))).toThrow(
    "Unable to decrypt",
  );
  expect(() => revealEmail(mfa, createFieldEncryptionCodec(process.env))).toThrow(
    "Unable to decrypt",
  );
  configure(1);
  expect(revealEmail(current.storedEmail, createFieldEncryptionCodec(process.env))).toBe(
    "user@example.test",
  );
  expect(revealMfaSecret(mfa, createMfaSecretCodec(process.env))).toBe("secret");
});
test("keyring reads ignore write flag and MFA remains encrypted with email encryption disabled", () => {
  configure();
  const email = protectEmail("user@example.test", createFieldEncryptionCodec(process.env));
  const mfa = protectMfaSecret("secret", createMfaSecretCodec(process.env));
  process.env.FEATURE_FIELD_ENCRYPTION = "false";
  expect(isFieldEncryptionEnabled(createFieldEncryptionCodec(process.env))).toBe(false);
  expect(protectEmail("User@example.test", createFieldEncryptionCodec(process.env))).toEqual({
    storedEmail: "user@example.test",
    emailLookup: "user@example.test",
  });
  expect(emailLookupForQuery("User@example.test", createFieldEncryptionCodec(process.env))).toBe(
    "user@example.test",
  );
  expect(revealEmail(email.storedEmail, createFieldEncryptionCodec(process.env))).toBe(
    "user@example.test",
  );
  expect(revealMfaSecret(mfa, createMfaSecretCodec(process.env))).toBe("secret");
  expect(protectMfaSecret("secret", createMfaSecretCodec(process.env)).startsWith("enc:v2:")).toBe(
    true,
  );
  expect(revealMfaSecret(null, createMfaSecretCodec(process.env))).toBeNull();
  expect(revealEmail("plain@example.test", createFieldEncryptionCodec(process.env))).toBe(
    "plain@example.test",
  );
  expect(() => revealMfaSecret("plaintext", createMfaSecretCodec(process.env))).toThrow(
    "must be encrypted",
  );
  process.env.FEATURE_FIELD_ENCRYPTION = "true";
  expect(
    protectEmail(
      "user@example.test",
      createFieldEncryptionCodec(process.env),
    ).storedEmail.startsWith("enc:v2:"),
  ).toBe(true);
});
test("missing or malformed configuration never treats identified ciphertext as plaintext", () => {
  configure();
  const email = protectEmail(
    "user@example.test",
    createFieldEncryptionCodec(process.env),
  ).storedEmail;
  const mfa = protectMfaSecret("secret", createMfaSecretCodec(process.env));
  delete process.env.KMS_ENCRYPTION_KEYRING;
  delete process.env.KMS_ENCRYPTION_KEY;
  expect(() => revealEmail(email, createFieldEncryptionCodec(process.env))).toThrow(
    "KMS_ENCRYPTION_KEYRING",
  );
  expect(() => revealMfaSecret(mfa, createMfaSecretCodec(process.env))).toThrow(
    "KMS_ENCRYPTION_KEYRING",
  );
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
    expect(() =>
      protectEmail("private@example.test", createFieldEncryptionCodec(process.env)),
    ).toThrow("Invalid KMS_ENCRYPTION_KEYRING configuration.");
    expect(() => protectMfaSecret("private", createMfaSecretCodec(process.env))).toThrow(
      "Invalid KMS_ENCRYPTION_KEYRING configuration.",
    );
  }
  configure();
  process.env.KMS_ENCRYPTION_KEY = original;
  expect(() => resolveFieldEncryptionKeyring(process.env)).toThrow(
    "Invalid KMS_ENCRYPTION_KEYRING configuration.",
  );
  configure();
  process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify({
    ...configuration(),
    encryptionKeys: { next: Buffer.from(next, "hex").toString("base64") },
  });
  expect(protectMfaSecret("secret", createMfaSecretCodec(process.env)).startsWith("enc:v2:")).toBe(
    true,
  );
  process.env.KMS_ENCRYPTION_KEYRING = JSON.stringify({
    ...configuration(),
    legacyV1Key: undefined,
  });
  expect(resolveFieldEncryptionKeyring(process.env)?.writeVersion).toBe(2);
});
test("separately bundled email and MFA entrypoints use the same configuration in three processes", async () => {
  configure();
  const config = process.env.KMS_ENCRYPTION_KEYRING;
  const program = `import {createFieldEncryptionCodec} from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/fieldEncryption.js"))};import{createMfaSecretCodec}from ${JSON.stringify(resolve("packages/strata-core/dist/entries/crypto/mfaSecret.js"))};const fields=createFieldEncryptionCodec(process.env);const secrets=createMfaSecretCodec(process.env);process.env.KMS_ENCRYPTION_KEYRING="invalid-after-assembly";const email=fields.protectEmail('User@example.test');const mfa=secrets.protectMfaSecret('secret');console.log(JSON.stringify({email:fields.revealEmail(email.storedEmail),lookup:fields.emailLookupForQuery('user@example.test'),storedLookup:email.emailLookup,mfa:secrets.revealMfaSecret(mfa),version:email.storedEmail.split(':').slice(0,3)}));`;
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
