import { expect, test } from "bun:test";
import {
  authenticatePasswordAccount,
  completeAccountToken,
  parseForgotPasswordEmail,
  parseLoginCredentials,
  parseRegisterCredentials,
  prepareAccountMail,
  registerAccount,
  withLoginAccount,
} from "@getstrata/bootstrap/auth/accountWorkflows";
import { hashPassword } from "@getstrata/core/auth/password";
import { createMfaSecretCodec } from "@getstrata/core/crypto/mfaSecret";
import { hashRecoveryCode } from "@getstrata/core/security/recoveryCodes";

test("login rechecks the account email after locking and passes the locked scope", async () => {
  const ports = { tenant: 7, signal: new AbortController().signal };
  const child = { ...ports };
  const result = await withLoginAccount(
    ports,
    "member@example.com",
    (supplied) => {
      expect(supplied).toBe(ports);
      return { findByEmail: async () => ({ id: 4, email: "member@example.com" }) };
    },
    async (supplied, id, work) => {
      expect(supplied).toBe(ports);
      expect(id).toBe(4);
      return work({ id, email: "changed@example.com" }, child);
    },
    async (account, scoped) => {
      expect(account).toBeNull();
      expect(scoped).toBe(child);
      expect(scoped.signal).toBe(ports.signal);
      return "denied";
    },
  );
  expect(result).toBe("denied");
});

test("missing login account preserves scope without taking a lock", async () => {
  const ports = { tenant: 9 };
  const result = await withLoginAccount(
    ports,
    "missing@example.com",
    () => ({ findByEmail: async () => null }),
    async () => {
      throw new Error("unexpected lock");
    },
    async (account, scoped) => {
      expect(account).toBeNull();
      expect(scoped).toBe(ports);
      return false;
    },
  );
  expect(result).toBe(false);
});

test("credential parsing normalizes email and enforces registration password policy", () => {
  expect(parseLoginCredentials({ email: "Member@EXAMPLE.com", password: "secret" }).email).toBe(
    "member@example.com",
  );
  expect(() =>
    parseRegisterCredentials({ name: "Member", email: "member@example.com", password: "short" }),
  ).toThrow();
});

test("registration only neutralizes verified uniqueness races after transaction unwind", async () => {
  const order: string[] = [];
  const failure = new Error("duplicate");
  const result = await registerAccount({}, "member@example.com", {
    write: async (ports, _id, work) => work(ports),
    transaction: async (ports, work) => {
      try {
        return await work(ports);
      } finally {
        order.push("rollback");
      }
    },
    create: async () => {
      throw failure;
    },
    isUniqueViolation: (error) => error === failure,
    accountExists: async () => {
      order.push("readback");
      return true;
    },
  });
  expect(result).toBeUndefined();
  expect(order).toEqual(["rollback", "readback"]);
});

test("signed token action keeps consume and mutation in the same transaction scope", async () => {
  const parent = { scope: "parent" },
    child = { scope: "transaction" };
  const failure = new Error("update failed");
  let rolledBack = false;
  await expect(
    completeAccountToken(parent, new Request("http://app.test/reset?token=secret"), "reset", {
      transaction: async (_ports, work) => {
        try {
          return await work(child);
        } catch (error) {
          rolledBack = true;
          throw error;
        }
      },
      consume: async (ports) => {
        expect(ports).toBe(child);
        return 4;
      },
      update: async (ports, id) => {
        expect(ports).toBe(child);
        expect(id).toBe(4);
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(rolledBack).toBe(true);
});

test("valid credential parsers normalize registration and reset identities", () => {
  expect(
    parseRegisterCredentials({
      name: "Member",
      email: "Member@EXAMPLE.com",
      password: "long-password",
    }),
  ).toEqual({ name: "Member", email: "member@example.com", password: "long-password" });
  expect(parseForgotPasswordEmail({ email: "Member@EXAMPLE.com" })).toBe("member@example.com");
  expect(
    parseLoginCredentials({ email: "member@example.com", password: "password", mfa_code: "123456" })
      .mfa_code,
  ).toBe("123456");
});

test("locked login carries the unchanged record into its bound operation", async () => {
  const parent = { tenant: 7 },
    child = { tenant: 7 };
  const user = { id: 4, email: "member@example.com" };
  await withLoginAccount(
    parent,
    user.email,
    () => ({ findByEmail: async () => user }),
    async (_ports, _id, work) => work(user, child),
    async (record, ports) => {
      expect(record).toBe(user);
      expect(ports).toBe(child);
    },
  );
});

test("password account checks deny bad credentials and inactive accounts before recovery persistence", async () => {
  const password = await hashPassword("long-password");
  const user = {
    password,
    is_active: true,
    mfa_enabled: false,
    mfa_secret: null,
    mfa_recovery_codes: null,
  };
  const secrets = createMfaSecretCodec({ APP_ENV: "local" });
  let persisted = 0;
  const persist = async () => {
    persisted++;
  };
  expect(
    await authenticatePasswordAccount(null, "long-password", undefined, secrets, persist),
  ).toEqual({ ok: false, error: "invalid_credentials" });
  expect(await authenticatePasswordAccount(user, "wrong", undefined, secrets, persist)).toEqual({
    ok: false,
    error: "invalid_credentials",
  });
  expect(
    await authenticatePasswordAccount(
      { ...user, is_active: false },
      "long-password",
      undefined,
      secrets,
      persist,
    ),
  ).toMatchObject({ ok: false, error: "account_inactive" });
  expect(
    await authenticatePasswordAccount(
      { ...user, mfa_enabled: true },
      "long-password",
      undefined,
      secrets,
      persist,
    ),
  ).toMatchObject({ ok: false, error: "mfa_required" });
  expect(persisted).toBe(0);
  const result = await authenticatePasswordAccount(
    user,
    "long-password",
    undefined,
    secrets,
    async (account, hash) => {
      expect(account).toBe(user);
      expect(hash).toBeUndefined();
      persisted++;
    },
  );
  expect(result).toEqual({ ok: true, user });
  expect(persisted).toBe(1);
  const consumed = hashRecoveryCode("recovery-code");
  const mfaUser = { ...user, mfa_enabled: true, mfa_recovery_codes: JSON.stringify([consumed]) };
  expect(
    await authenticatePasswordAccount(
      mfaUser,
      "long-password",
      "recovery-code",
      secrets,
      async (account, hash) => {
        expect(account).toBe(mfaUser);
        expect(hash).toBe(consumed);
      },
    ),
  ).toMatchObject({ ok: true, consumedRecoveryHash: consumed });
});

test("successful registration returns transaction result without a race readback", async () => {
  const parent = { scope: "parent" },
    locked = { scope: "locked" },
    child = { scope: "transaction" };
  const saved = { id: 7 };
  const result = await registerAccount(parent, "member@example.com", {
    write: async (ports, id, work) => {
      expect(ports).toBe(parent);
      expect(id).toBe("member@example.com");
      return work(locked);
    },
    transaction: async (ports, work) => {
      expect(ports).toBe(locked);
      return work(child);
    },
    create: async (ports) => {
      expect(ports).toBe(child);
      return saved;
    },
    isUniqueViolation: () => {
      throw new Error("unexpected classifier");
    },
    accountExists: async () => {
      throw new Error("unexpected readback");
    },
  });
  expect(result).toBe(saved);
});

test("signed token action skips absent tokens and commits successful mutation in its child", async () => {
  for (const userId of [null, 4]) {
    const ports = { scope: "parent" },
      child = { scope: "transaction" };
    const request = new Request("http://app.test/reset");
    let mutations = 0;
    const result = await completeAccountToken(ports, request, "reset", {
      transaction: async (_ports, work) => work(child),
      consume: async (scoped, supplied, purpose) => {
        expect(scoped).toBe(child);
        expect(supplied).toBe(request);
        expect(purpose).toBe("reset");
        return userId;
      },
      update: async (scoped, id) => {
        expect(scoped).toBe(child);
        if (userId === null) throw new Error("Missing token must not mutate an account");
        expect(id).toBe(userId);
        mutations++;
      },
    });
    expect(result).toBe(userId !== null);
    expect(mutations).toBe(userId === null ? 0 : 1);
  }
});

test("signed account mail waits for scoped token persistence before signing its secret", async () => {
  const ports = { tenant: 7 };
  const order: string[] = [];
  const before = Date.now();
  const mail = await prepareAccountMail(
    ports,
    {
      to: "member@example.com",
      subject: "Verify",
      path: "/verify",
      purpose: "verify",
      userId: 4,
      extra: { id: "4" },
    },
    {
      issue: () => ({ plain: "secret", hash: "stored-hash" }),
      store: async (scoped, token) => {
        expect(scoped).toBe(ports);
        expect(token).toMatchObject({ purpose: "verify", userId: 4, hash: "stored-hash" });
        expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600000);
        await Promise.resolve();
        order.push("persisted");
      },
      sign: (path, ttl, parameters) => {
        expect(order).toEqual(["persisted"]);
        expect(path).toBe("/verify");
        expect(ttl).toBe(3600);
        expect(parameters).toEqual({ id: "4", token: "secret" });
        return "https://app.test/signed";
      },
    },
  );
  expect(mail).toEqual({
    to: "member@example.com",
    subject: "Verify",
    body: "Verify\n\nhttps://app.test/signed\n",
  });
  const failed = new Error("token write failed");
  await expect(
    prepareAccountMail(
      ports,
      {
        to: "member@example.com",
        subject: "Verify",
        path: "/verify",
        purpose: "verify",
        userId: 4,
      },
      {
        issue: () => ({ plain: "secret", hash: "hash" }),
        store: async () => {
          throw failed;
        },
        sign: () => {
          throw new Error("must not sign an unpersisted token");
        },
      },
    ),
  ).rejects.toBe(failed);
});
