import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ENCRYPTION_PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function resolveEncryptionKey(): Buffer | null {
  const raw = process.env.KMS_ENCRYPTION_KEY?.trim();

  if (!raw) {
    return null;
  }

  if (/^[0-9a-f]{64}$/i.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");

  if (decoded.length === 32) {
    return decoded;
  }

  throw new Error("KMS_ENCRYPTION_KEY must be 32 bytes (hex or base64).");
}

function isFieldEncryptionEnabled(): boolean {
  const featureFlag = process.env.FEATURE_FIELD_ENCRYPTION;

  if (featureFlag === "false") {
    return false;
  }

  if (featureFlag === "true") {
    return true;
  }

  return (process.env.APP_ENV ?? "local") === "production";
}

function encryptField(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, encrypted, tag]).toString("base64");

  return `${ENCRYPTION_PREFIX}${payload}`;
}

function decryptField(value: string, key: Buffer): string {
  if (!value.startsWith(ENCRYPTION_PREFIX)) {
    return value;
  }

  const payload = Buffer.from(value.slice(ENCRYPTION_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(payload.length - TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH, payload.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function hashLookupValue(normalizedValue: string, key: Buffer): string {
  return createHmac("sha256", key).update(normalizedValue).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function protectEmail(email: string): { storedEmail: string; emailLookup: string } {
  const normalized = normalizeEmail(email);
  const key = resolveEncryptionKey();

  if (!key || !isFieldEncryptionEnabled()) {
    return { storedEmail: normalized, emailLookup: normalized };
  }

  return {
    storedEmail: encryptField(normalized, key),
    emailLookup: hashLookupValue(normalized, key),
  };
}

function revealEmail(storedEmail: string): string {
  const key = resolveEncryptionKey();

  if (!key || !storedEmail.startsWith(ENCRYPTION_PREFIX)) {
    return storedEmail;
  }

  return decryptField(storedEmail, key);
}

function emailLookupForQuery(email: string): string {
  const normalized = normalizeEmail(email);
  const key = resolveEncryptionKey();

  if (!key || !isFieldEncryptionEnabled()) {
    return normalized;
  }

  return hashLookupValue(normalized, key);
}

export {
  decryptField,
  emailLookupForQuery,
  encryptField,
  hashLookupValue,
  isFieldEncryptionEnabled,
  normalizeEmail,
  protectEmail,
  revealEmail,
  resolveEncryptionKey,
};
