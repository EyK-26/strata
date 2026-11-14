import { expect, test } from "bun:test";
import {
  completeAccountToken,
  parseLoginCredentials,
  parseRegisterCredentials,
  registerAccount,
  withLoginAccount,
} from "@getstrata/bootstrap/auth/accountWorkflows";

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
