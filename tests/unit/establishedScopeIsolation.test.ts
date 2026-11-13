import { expect, test } from "bun:test";
import { establishedAuthReader, runWithEstablishedAuth } from "@getstrata/core/auth/authReader";
import { absentAuth, authenticatedAuth } from "@getstrata/core/auth/guard";
import {
  getActiveDatabaseConnection,
  hasActiveDatabaseConnection,
  runWithDatabaseConnection,
} from "../../src/core/database/connectionContext";

test("established authentication outcomes retain the installed request and never invent a principal", async () => {
  const request = new Request("http://scope.test/");
  const other = new Request("http://scope.test/");
  const user = { id: 19, role: "viewer" };
  await expect(establishedAuthReader.authenticate(request)).rejects.toThrow("scope mismatch");
  await runWithEstablishedAuth(request, { user, credentialSource: "bearer" }, async () => {
    await Promise.resolve();
    expect(await establishedAuthReader.authenticate(request)).toEqual(
      authenticatedAuth(user, "bearer"),
    );
    await expect(establishedAuthReader.authenticate(other)).rejects.toThrow("scope mismatch");
    await runWithEstablishedAuth(other, { user: null, credentialSource: null }, async () => {
      expect(await establishedAuthReader.authenticate(other)).toEqual(absentAuth);
    });
    expect(await establishedAuthReader.authenticate(request)).toEqual(
      authenticatedAuth(user, "bearer"),
    );
  });
  await expect(establishedAuthReader.authenticate()).rejects.toThrow("scope mismatch");
});

test("database context is nested, restores after rejection and isolates interleaved operations", async () => {
  const fallback = { unsafe: async <T>() => [] as T[] };
  const first = { unsafe: async <T>() => [] as T[] };
  const second = { unsafe: async <T>() => [] as T[] };
  const failure = new Error("owned operation failed");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  expect(hasActiveDatabaseConnection()).toBe(false);
  expect(getActiveDatabaseConnection(fallback)).toBe(fallback);
  const waiting = runWithDatabaseConnection(first, async () => {
    expect(hasActiveDatabaseConnection()).toBe(true);
    await gate;
    expect(getActiveDatabaseConnection(fallback)).toBe(first);
    await expect(
      runWithDatabaseConnection(second, async () => {
        expect(getActiveDatabaseConnection(fallback)).toBe(second);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(getActiveDatabaseConnection(fallback)).toBe(first);
  });
  await runWithDatabaseConnection(second, async () => {
    await Promise.resolve();
    expect(hasActiveDatabaseConnection()).toBe(true);
    expect(getActiveDatabaseConnection(fallback)).toBe(second);
    release();
  });
  await waiting;
  expect(hasActiveDatabaseConnection()).toBe(false);
  expect(getActiveDatabaseConnection(fallback)).toBe(fallback);
});
